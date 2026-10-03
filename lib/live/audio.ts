/* Microphone → 16-bit PCM chunks (resampled in an AudioWorklet), and a gapless PCM player. */

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.target = opts.processorOptions.target;
    this.ratio = sampleRate / this.target;
    this.buf = [];
    this.pos = 0;
    this.chunk = Math.round(this.target * 0.04);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Linear resampling from the context rate to the target rate.
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    if (this.buf.length >= this.chunk) {
      const out = new Int16Array(this.buf);
      this.buf = [];
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type MicCapture = { stop: () => void; setMuted: (m: boolean) => void; level: () => number };

export async function startMicPcm(onChunk: (b64: string) => void, targetRate = 16000): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  let src: MediaStreamAudioSourceNode;
  let node: AudioWorkletNode;
  try {
    if (!ctx.audioWorklet) throw Object.assign(new Error('AudioWorklet unsupported'), { name: 'NotSupportedError' });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'pcm-capture', { processorOptions: { target: targetRate } });
  } catch (e) {
    // Never leave the microphone on when setup fails half way.
    stream.getTracks().forEach(t => t.stop());
    void ctx.close().catch(() => {});
    throw e;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  src.connect(node);
  let muted = false;
  node.port.onmessage = e => { if (!muted) onChunk(bytesToB64(e.data as ArrayBuffer)); };
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const data = new Uint8Array(analyser.frequencyBinCount);
  return {
    stop: () => {
      try { node.port.onmessage = null; node.disconnect(); src.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach(t => t.stop());
      void ctx.close().catch(() => {});
    },
    setMuted: m => { muted = m; stream.getAudioTracks().forEach(t => { t.enabled = !m; }); },
    level: () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      return peak / 128;
    },
  };
}

export class PcmPlayer {
  private ctx: AudioContext;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  constructor(private rate = 24000) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
  }
  get playing() { return this.sources.size > 0; }
  async resume() { if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {}); }
  play(b64: string, mime = 'audio/pcm;rate=24000') {
    const m = /rate=(\d+)/.exec(mime);
    const rate = m ? Number(m[1]) : this.rate;
    const bytes = b64ToBytes(b64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (!samples.length) return;
    const buf = this.ctx.createBuffer(1, samples.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + 0.02, this.next);
    src.start(at);
    this.next = at + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }
  interrupt() {
    for (const s of this.sources) { try { s.stop(); } catch { /* ignore */ } }
    this.sources.clear();
    this.next = 0;
  }
  close() { this.interrupt(); void this.ctx.close().catch(() => {}); }
}
