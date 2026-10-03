/* Text-to-speech and speech recognition (Web Speech API) with graceful fallbacks. */

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>; resultIndex?: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
}

let active: Rec | null = null;

/** Listens once; resolves with the transcript ('' if nothing). Rejects with 'not-allowed' etc. */
export function listen(lang: 'ko-KR' | 'ja-JP', onInterim?: (t: string) => void): { promise: Promise<string>; stop: () => void } {
  const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!SR) return { promise: Promise.reject(new Error('unsupported')), stop: () => {} };
  active?.abort();
  const r = new SR();
  active = r;
  r.lang = lang; r.interimResults = !!onInterim; r.continuous = false; r.maxAlternatives = 1;
  let final = '';
  let interim = '';
  const promise = new Promise<string>((resolve, reject) => {
    r.onresult = e => {
      let fin = '', mid = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript || '';
        if ((res as { isFinal?: boolean }).isFinal) fin += t; else mid += t;
      }
      final = fin;
      interim = mid;
      onInterim?.(fin + mid);
    };
    r.onerror = e => { if (e.error === 'no-speech' || e.error === 'aborted') resolve((final || interim).trim()); else reject(new Error(e.error)); };
    r.onend = () => { if (active === r) active = null; resolve((final || interim).trim()); };
    try { r.start(); } catch (e) { reject(e); }
  });
  return { promise, stop: () => { try { r.stop(); } catch { /* ignore */ } } };
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const vs = speechSynthesis.getVoices();
  const base = lang.slice(0, 2);
  return vs.find(v => v.lang.replace('_', '-') === lang && /google|natural|premium|enhanced/i.test(v.name))
    || vs.find(v => v.lang.replace('_', '-') === lang)
    || vs.find(v => v.lang.startsWith(base));
}

export function speak(text: string, lang: 'ko-KR' | 'ja-JP' = 'ko-KR', rate = 1.02): Promise<void> {
  return new Promise(resolve => {
    if (typeof speechSynthesis === 'undefined' || !text.trim()) return resolve();
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 900));
      u.lang = lang; u.rate = rate;
      const v = voiceFor(lang);
      if (v) u.voice = v;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, Math.min(60000, 2000 + text.length * 120));
    } catch { resolve(); }
  });
}

export function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
}

export function hasVoice(lang: string): boolean {
  try { return !!voiceFor(lang); } catch { return false; }
}
