/* Gemini Live over WebSocket: 16 kHz mic audio + camera frames in, 24 kHz speech + transcripts out. */
import { geminiSchema } from '../ai/gemini';
import { appHeaders } from '../ai/transport';
import { api } from '../api';
import { PcmPlayer, startMicPcm, type MicCapture } from './audio';
import { runLiveTool } from './tools';
import { LiveError, sleep, type LiveClient, type LiveHandlers, type LiveOptions } from './types';

type Obj = Record<string, any>;

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const dec = new TextDecoder();

function decode(data: unknown): Obj | null {
  try {
    const s = typeof data === 'string' ? data : data instanceof ArrayBuffer ? dec.decode(data) : '';
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

/** Transcripts arrive as chunks on some versions and as the running text on others. */
export function mergeTranscript(prev: string, chunk: string): string {
  if (!prev) return chunk;
  if (chunk.startsWith(prev)) return chunk;
  return prev + chunk;
}

export function closeError(code: number, reason: string): LiveError {
  if (/api.?key|permission|unauthori[sz]ed|unauthenticated|access.?token|expired/i.test(reason)) return new LiveError('Gemini 인증에 실패했어요. 키나 접속 코드를 확인해 주세요.', 'auth');
  if (/quota|resource.?exhausted|rate.?limit/i.test(reason)) return new LiveError('Gemini 사용 한도에 걸렸어요. 잠시 후 다시 시도해 주세요.', 'rate');
  if (code === 1006 && !reason) return new LiveError('연결이 끊겼어요. 인터넷 연결을 확인해 주세요.', 'network');
  return new LiveError(reason ? `Gemini 연결이 끊겼어요: ${reason.slice(0, 140)}` : `Gemini 연결이 끊겼어요 (${code})`, code === 1007 || code === 1008 ? 'other' : 'server');
}

export function tokenError(e: unknown): LiveError {
  const status = (e as { status?: number })?.status;
  const msg = String((e as Error)?.message || e);
  if (status === 401 || status === 403) return new LiveError(msg, 'auth');
  if (status === 503) return new LiveError(msg, 'auth');
  if (status === 429) return new LiveError('실시간 대화를 너무 자주 열었어요. 잠시 후 다시 시도해 주세요.', 'rate');
  if ((e as Error)?.name === 'AbortError') return new LiveError('취소됐어요', 'other');
  return new LiveError(msg || '연결을 준비하지 못했어요', status ? 'server' : 'network');
}

export function micError(e: unknown): LiveError {
  const n = (e as Error)?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return new LiveError('마이크 권한이 필요해요. 주소창 왼쪽 아이콘 → 권한에서 마이크를 허용해 주세요.', 'permission');
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return new LiveError('마이크를 찾을 수 없어요.', 'unsupported');
  if (n === 'NotReadableError') return new LiveError('다른 앱이 마이크를 쓰고 있어요. 통화나 녹음 앱을 닫아 주세요.', 'unsupported');
  return new LiveError(`마이크를 켜지 못했어요 (${n || String(e)})`, 'unsupported');
}

/** Closes a replaced socket after letting the tail of its last answer play. */
function retire(ws: WebSocket) {
  ws.onclose = null;
  setTimeout(() => {
    ws.onmessage = null;
    try { ws.close(1000); } catch { /* ignore */ }
  }, 4000);
}

export class GeminiLive implements LiveClient {
  readonly kind = 'gemini' as const;
  private ws: WebSocket | null = null;
  /** Socket still waiting for setupComplete (closed too if the user leaves meanwhile). */
  private pending: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private player: PcmPlayer | null = null;
  private resumeHandle: string | null = null;
  private model = '';
  private stopped = false;
  private reconnecting = false;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private frameBusy = false;
  private lastFrame = 0;
  private lastVoice = 0;
  private userLine = '';
  private aiLine = '';
  private turnOpen = false;
  private dropAudio = false;
  private cancelled = new Set<string>();
  private ctl = new AbortController();

  constructor(private o: LiveOptions, private h: LiveHandlers) {}

  async start() {
    this.h.onState('connecting');
    try {
      this.player = new PcmPlayer(24000);
      void this.player.resume();
      let mic: MicCapture;
      try {
        mic = await startMicPcm(b64 => this.send({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } }));
      } catch (e) { throw micError(e); }
      if (this.stopped) { mic.stop(); throw new LiveError('취소됐어요'); }
      this.mic = mic;
      await this.connect(false);
    } catch (e) {
      this.stopped = true;
      this.cleanup();
      throw e;
    }
    if (this.stopped) return;
    this.h.onState('live');
    await this.pushFrame();
    if (this.o.greeting) this.send({ realtimeInput: { text: this.o.greeting } });
    this.frameTimer = setInterval(() => void this.tickFrame(), 500);
  }

  private setup(resume: boolean): Obj {
    const s: Obj = {
      model: `models/${this.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice || 'Kore' } } },
      },
      systemInstruction: { parts: [{ text: this.o.instructions }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: resume && this.resumeHandle ? { handle: this.resumeHandle } : {},
    };
    if (this.o.tools.length) {
      s.tools = [{ functionDeclarations: this.o.tools.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }];
    }
    return s;
  }

  private async connect(resume: boolean): Promise<void> {
    let t: { token: string; model: string };
    try {
      t = await api<{ token: string; model: string }>('/api/live/gemini', {
        method: 'POST', body: JSON.stringify({ model: this.o.model }), headers: appHeaders('gemini'), timeout: 20000, signal: this.ctl.signal,
      });
    } catch (e) { throw tokenError(e); }
    if (this.stopped) throw new LiveError('취소됐어요');
    this.model = t.model;
    const ws = new WebSocket(`${WS_URL}?access_token=${t.token}`);
    ws.binaryType = 'arraybuffer';
    this.pending = ws;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        if (ready) return;
        ready = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new LiveError('Gemini 연결 시간이 초과됐어요. 인터넷 연결을 확인해 주세요.', 'network'));
      }, 15000);
      ws.onopen = () => { try { ws.send(JSON.stringify({ setup: this.setup(resume) })); } catch { /* close follows */ } };
      ws.onmessage = ev => {
        const m = decode(ev.data);
        if (!m) return;
        if (!ready) {
          if (m.setupComplete) {
            ready = true;
            clearTimeout(timer);
            if (this.pending === ws) this.pending = null;
            if (this.stopped) {
              ws.onclose = null;
              try { ws.close(1000); } catch { /* ignore */ }
              reject(new LiveError('취소됐어요'));
              return;
            }
            const old = this.ws;
            this.ws = ws;
            if (old && old !== ws) retire(old);
            resolve();
          }
          return;
        }
        this.onMessage(m, ws);
      };
      ws.onclose = ev => {
        clearTimeout(timer);
        if (this.pending === ws) this.pending = null;
        if (!ready) { ready = true; reject(closeError(ev.code, ev.reason)); return; }
        if (ws === this.ws && !this.stopped) void this.reconnect(ev.code, ev.reason);
      };
    });
  }

  private async reconnect(code?: number, reason?: string) {
    if (this.stopped || this.reconnecting) return;
    if (code != null) {
      const err = closeError(code, reason || '');
      if (err.code === 'auth' || err.code === 'rate' || code === 1007 || code === 1008) { this.fail(err); return; }
    }
    this.reconnecting = true;
    this.h.onState('reconnecting');
    let last: unknown = null;
    for (let i = 0; i < 3 && !this.stopped; i++) {
      if (i > 0) this.resumeHandle = null; // a stale handle shouldn't block a fresh session
      const resumed = !!this.resumeHandle;
      try {
        await this.connect(true);
        this.reconnecting = false;
        if (this.stopped) return;
        this.h.onState('live');
        if (!resumed) this.send({ realtimeInput: { text: '(앱 알림) 연결이 잠깐 끊겼다가 다시 이어졌어. 지금 화면을 보고 짧게 이어서 안내해 줘.' } });
        return;
      } catch (e) {
        last = e;
        if (e instanceof LiveError && (e.code === 'auth' || e.code === 'rate')) break;
        await sleep(900 * (i + 1));
      }
    }
    this.reconnecting = false;
    if (!this.stopped) this.fail(last);
  }

  private onMessage(m: Obj, ws: WebSocket) {
    const upd = m.sessionResumptionUpdate;
    if (upd?.newHandle && upd.resumable !== false) this.resumeHandle = upd.newHandle;
    if (m.goAway && ws === this.ws) void this.reconnect();
    if (m.toolCall?.functionCalls?.length) void this.runTools(m.toolCall.functionCalls);
    if (Array.isArray(m.toolCallCancellation?.ids)) for (const id of m.toolCallCancellation.ids) this.cancelled.add(String(id));
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { this.player?.interrupt(); this.endAi(); this.turnOpen = false; this.dropAudio = false; }
    if (typeof sc.inputTranscription?.text === 'string' && sc.inputTranscription.text) {
      this.userLine = mergeTranscript(this.userLine, sc.inputTranscription.text);
      this.lastVoice = Date.now();
      this.h.onCaption('user', this.userLine.trim(), false);
    }
    const parts: Obj[] = sc.modelTurn?.parts || [];
    for (const p of parts) {
      const d = p.inlineData;
      if (d?.data && (!d.mimeType || String(d.mimeType).startsWith('audio/')) && !this.dropAudio) this.player?.play(d.data, d.mimeType || 'audio/pcm;rate=24000');
    }
    if (parts.length) this.turnOpen = true;
    if (typeof sc.outputTranscription?.text === 'string' && sc.outputTranscription.text) {
      this.endUser();
      this.turnOpen = true;
      if (!this.dropAudio) {
        this.aiLine = mergeTranscript(this.aiLine, sc.outputTranscription.text);
        this.h.onCaption('ai', this.aiLine.trim(), false);
      }
    }
    if (sc.turnComplete) { this.endUser(); this.endAi(); this.turnOpen = false; this.dropAudio = false; }
  }

  private endUser() {
    if (this.userLine.trim()) this.h.onCaption('user', this.userLine.trim(), true);
    this.userLine = '';
  }

  private endAi() {
    if (this.aiLine.trim()) this.h.onCaption('ai', this.aiLine.trim(), true);
    this.aiLine = '';
  }

  private async runTools(calls: Obj[]) {
    const hooks = { step: (s: string) => this.h.onStep(s), sources: (s: Parameters<LiveHandlers['onSources']>[0]) => this.h.onSources(s) };
    const responses = await Promise.all(calls.map(async c => ({
      id: c.id, name: c.name,
      response: await runLiveTool(this.o.tools, String(c.name || ''), c.args, hooks, this.ctl.signal),
    })));
    const keep = responses.filter(r => !this.cancelled.has(String(r.id)));
    if (keep.length && !this.stopped) this.send({ toolResponse: { functionResponses: keep } });
  }

  private send(msg: Obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* close follows */ }
  }

  private async tickFrame() {
    if (this.frameBusy || this.stopped || !this.ws) return;
    const now = Date.now();
    if ((this.mic?.level() ?? 0) > 0.08) this.lastVoice = now;
    const active = now - this.lastVoice < 4000 || this.turnOpen || !!this.player?.playing;
    const gap = (active ? 1000 : 3000) * (this.o.saver ? 2 : 1);
    if (now - this.lastFrame >= gap) await this.pushFrame();
  }

  private async pushFrame() {
    if (this.frameBusy) return;
    this.frameBusy = true;
    try {
      if (!this.ws || this.ws.bufferedAmount > 200_000) return;
      const b64 = await this.o.frame();
      if (!b64 || this.stopped) return;
      this.lastFrame = Date.now();
      this.send({ realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } } });
    } catch { /* camera hiccup */ } finally { this.frameBusy = false; }
  }

  sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    this.endUser();
    this.h.onCaption('user', t, true);
    this.send({ realtimeInput: { text: t } });
  }

  lookNow() {
    void (async () => {
      await this.pushFrame();
      this.endUser();
      this.h.onCaption('user', '📷 지금 화면 봐 줘', true);
      this.send({ realtimeInput: { text: '방금 보낸 카메라 화면을 보고 지금 어디로 가면 되는지 짧게 안내해 줘.' } });
    })();
  }

  setMuted(m: boolean) {
    this.mic?.setMuted(m);
    if (m) this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  interrupt() {
    this.player?.interrupt();
    if (this.turnOpen) this.dropAudio = true;
    this.endAi();
  }

  speaking() { return !!this.player?.playing; }
  level() { return this.mic?.level() ?? 0; }
  resumeAudio() { void this.player?.resume(); }

  private fail(e: unknown) {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
    this.h.onState('error', e instanceof Error ? e.message : String(e || '연결이 끊겼어요'));
  }

  private cleanup() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
    const p = this.pending;
    this.pending = null;
    if (p) { p.onclose = null; p.onmessage = null; try { p.close(1000); } catch { /* ignore */ } }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try { ws.close(1000); } catch { /* ignore */ }
    }
    this.mic?.stop();
    this.mic = null;
    this.player?.close();
    this.player = null;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ctl.abort();
    this.cleanup();
    this.h.onState('ended');
  }
}
