/* ChatGPT Realtime over WebRTC: mic audio in, speech out, camera snapshots as image items. */
import { appHeaders } from '../ai/transport';
import { api } from '../api';
import { micError, tokenError } from './gemini';
import { runLiveTool } from './tools';
import { LiveError, type LiveClient, type LiveHandlers, type LiveOptions } from './types';

type Obj = Record<string, any>;

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export class OpenAiLive implements LiveClient {
  readonly kind = 'openai' as const;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private actx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;
  private aiSpeaking = false;
  private responseActive = false;
  private userLine = '';
  private aiLine = '';
  private lastImage = 0;
  private stopped = false;
  private handled = new Set<string>();
  private retried = { transcription: false, noise: false };
  private ctl = new AbortController();

  constructor(private o: LiveOptions, private h: LiveHandlers) {}

  async start() {
    this.h.onState('connecting');
    try {
      await this.open();
    } catch (e) {
      this.stopped = true;
      this.cleanup();
      throw e;
    }
  }

  private async open() {
    if (typeof RTCPeerConnection === 'undefined') throw new LiveError('이 브라우저는 실시간 음성(WebRTC)을 지원하지 않아요.', 'unsupported');
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    this.audio = audio;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { throw micError(e); }
    if (this.stopped) { stream.getTracks().forEach(t => t.stop()); throw new LiveError('취소됐어요'); }
    this.stream = stream;
    this.meter(stream);
    let secret: { value: string; model: string };
    try {
      secret = await api<{ value: string; model: string }>('/api/live/openai', {
        method: 'POST',
        body: JSON.stringify({
          model: this.o.model, voice: this.o.voice, instructions: this.o.instructions,
          tools: this.o.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
        }),
        headers: appHeaders('openai'), timeout: 20000, signal: this.ctl.signal,
      });
    } catch (e) { throw tokenError(e); }
    if (this.stopped) throw new LiveError('취소됐어요');

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = e => {
      audio.srcObject = e.streams[0];
      void audio.play().catch(() => this.h.onStep('소리가 안 들리면 화면을 한 번 눌러 주세요'));
    };
    for (const t of stream.getAudioTracks()) pc.addTrack(t, stream);
    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = e => {
      let ev: Obj;
      try { ev = JSON.parse(String(e.data)); } catch { return; }
      this.onEvent(ev);
    };
    let isOpen = false;
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new LiveError('ChatGPT 연결 시간이 초과됐어요. 인터넷 연결을 확인해 주세요.', 'network')), 20000);
      dc.onopen = () => { isOpen = true; clearTimeout(timer); resolve(); };
      dc.onclose = () => {
        clearTimeout(timer);
        if (!isOpen) reject(new LiveError('ChatGPT와 연결하지 못했어요.', 'network'));
        else if (!this.stopped) this.fail(new LiveError('ChatGPT 연결이 끊겼어요.', 'network'));
      };
    });
    opened.catch(() => { /* awaited below; avoids an unhandled rejection while the SDP exchange runs */ });
    pc.onconnectionstatechange = () => {
      if (this.stopped || !isOpen) return;
      if (pc.connectionState === 'failed') this.fail(new LiveError('연결이 끊겼어요. 인터넷 연결을 확인해 주세요.', 'network'));
      else if (pc.connectionState === 'disconnected') this.h.onState('reconnecting');
      else if (pc.connectionState === 'connected') this.h.onState('live');
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let r: Response;
    try {
      r = await fetch(CALLS_URL, { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${secret.value}`, 'Content-Type': 'application/sdp' }, signal: this.ctl.signal });
    } catch {
      throw new LiveError('ChatGPT 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', 'network');
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      let msg = body;
      try { msg = JSON.parse(body)?.error?.message || body; } catch { /* plain text */ }
      throw new LiveError(`ChatGPT 연결 실패 (${r.status})${msg ? `: ${msg.slice(0, 140)}` : ''}`, r.status === 401 || r.status === 403 ? 'auth' : r.status === 429 ? 'rate' : 'server');
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    await opened;
    if (this.stopped) return;
    this.configure();
    this.h.onState('live');
    if (this.o.greeting) {
      await this.pushImage(0);
      this.sendUserText(this.o.greeting);
    }
  }

  /** Transcription and far-field noise reduction go in a separate update so the session survives if either is unsupported. */
  private configure() {
    const input: Obj = { transcription: { model: this.retried.transcription ? 'whisper-1' : 'gpt-4o-mini-transcribe' } };
    if (!this.retried.noise) input.noise_reduction = { type: 'far_field' };
    this.send({ type: 'session.update', session: { type: 'realtime', audio: { input } } });
  }

  private meter(stream: MediaStream) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.actx = new AC();
      const src = this.actx.createMediaStreamSource(stream);
      this.analyser = this.actx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
      this.buf = new Uint8Array(this.analyser.frequencyBinCount);
    } catch { /* level stays 0 */ }
  }

  private send(ev: Obj): boolean {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') return false;
    const s = JSON.stringify(ev);
    const max = this.pc?.sctp?.maxMessageSize || 262144;
    if (s.length > max) return false;
    try { dc.send(s); return true; } catch { return false; }
  }

  private endAi() {
    if (this.aiLine.trim()) this.h.onCaption('ai', this.aiLine.trim(), true);
    this.aiLine = '';
  }

  private onEvent(ev: Obj) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        this.endAi();
        this.userLine = '';
        this.h.onCaption('user', '…', false);
        void this.pushImage(2500); // let the model see what the user is looking at while they ask
        break;
      case 'conversation.item.input_audio_transcription.delta':
        this.userLine += ev.delta || '';
        this.h.onCaption('user', this.userLine.trim() || '…', false);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.h.onCaption('user', String(ev.transcript ?? this.userLine).trim(), true);
        this.userLine = '';
        break;
      case 'conversation.item.input_audio_transcription.failed':
        this.h.onCaption('user', this.userLine.trim(), true);
        this.userLine = '';
        break;
      case 'response.created':
        this.responseActive = true;
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.aiLine += ev.delta || '';
        this.h.onCaption('ai', this.aiLine.trim(), false);
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (typeof ev.transcript === 'string' && ev.transcript) this.aiLine = ev.transcript;
        this.endAi();
        break;
      case 'output_audio_buffer.started':
        this.aiSpeaking = true;
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.aiSpeaking = false;
        break;
      case 'response.done':
        this.responseActive = false;
        void this.onResponseDone(ev.response || {});
        break;
      case 'error': {
        const e = ev.error || {};
        const where = `${e.param || ''} ${e.message || ''}`;
        if (/noise_reduction/i.test(where) && !this.retried.noise) { this.retried.noise = true; this.configure(); break; }
        if (/transcription/i.test(where) && !this.retried.transcription) { this.retried.transcription = true; this.configure(); break; }
        if (/cancel/i.test(String(e.code || '')) || /no active response/i.test(String(e.message || ''))) break;
        this.h.onStep(`⚠ ${String(e.message || '오류').slice(0, 140)}`);
        break;
      }
      default:
        break;
    }
  }

  private async onResponseDone(r: Obj) {
    if (r.status === 'failed') {
      const e = r.status_details?.error;
      this.h.onStep(`⚠ ${String(e?.message || '응답을 만들지 못했어요').slice(0, 140)}`);
    }
    const calls = (Array.isArray(r.output) ? r.output : []).filter((x: Obj) => x?.type === 'function_call' && x.call_id && !this.handled.has(x.call_id));
    if (!calls.length) return;
    calls.forEach((c: Obj) => this.handled.add(c.call_id));
    const hooks = { step: (s: string) => this.h.onStep(s), sources: (s: Parameters<LiveHandlers['onSources']>[0]) => this.h.onSources(s) };
    const outs = await Promise.all(calls.map(async (c: Obj) => {
      let args: unknown = {};
      try { args = JSON.parse(c.arguments || '{}'); } catch { /* empty args */ }
      return { call_id: c.call_id as string, output: await runLiveTool(this.o.tools, String(c.name || ''), args, hooks, this.ctl.signal) };
    }));
    if (this.stopped) return;
    for (const o of outs) this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: o.call_id, output: JSON.stringify(o.output) } });
    this.send({ type: 'response.create' });
  }

  private async pushImage(minGapMs: number): Promise<boolean> {
    if (Date.now() - this.lastImage < minGapMs) return false;
    const b64 = await this.o.frame().catch(() => null);
    if (!b64 || this.stopped) return false;
    const ok = this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${b64}` }] } });
    if (ok) this.lastImage = Date.now();
    return ok;
  }

  private sendUserText(text: string) {
    if (this.responseActive) this.send({ type: 'response.cancel' });
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.send({ type: 'response.create' });
  }

  sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    this.h.onCaption('user', t, true);
    this.sendUserText(t);
  }

  lookNow() {
    void (async () => {
      const ok = await this.pushImage(0);
      this.h.onCaption('user', '📷 지금 화면 봐 줘', true);
      this.sendUserText(ok ? '방금 보낸 카메라 화면을 보고 지금 어디로 가면 되는지 짧게 안내해 줘.' : '카메라 화면을 보낼 수 없어. 지금 위치 기준으로 짧게 안내해 줘.');
    })();
  }

  setMuted(m: boolean) {
    this.stream?.getAudioTracks().forEach(t => { t.enabled = !m; });
  }

  interrupt() {
    if (this.responseActive) this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
    this.aiSpeaking = false;
    this.endAi();
  }

  speaking() { return this.aiSpeaking; }

  level() {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let peak = 0;
    for (const v of this.buf) peak = Math.max(peak, Math.abs(v - 128));
    return peak / 128;
  }

  resumeAudio() {
    void this.audio?.play().catch(() => {});
    if (this.actx?.state === 'suspended') void this.actx.resume().catch(() => {});
  }

  private fail(e: unknown) {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
    this.h.onState('error', e instanceof Error ? e.message : String(e || '연결이 끊겼어요'));
  }

  private cleanup() {
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    this.dc = null;
    this.pc = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.audio) { this.audio.srcObject = null; this.audio = null; }
    void this.actx?.close().catch(() => {});
    this.actx = null;
    this.analyser = null;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ctl.abort();
    this.cleanup();
    this.h.onState('ended');
  }
}
