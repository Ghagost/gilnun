/* Turn-based camera conversation (Claude, or any model without a realtime voice API):
   push to talk → speech recognition → camera snapshot + question → answer read aloud. */
import { runAgent } from '../ai/agent';
import { contextBlock } from '../ai/prompts';
import { aiErrorText } from '../ai/transport';
import type { HistoryMsg } from '../ai/types';
import { listen, speak, speechSupported, stopSpeaking } from '../speech';
import { settings } from '../store/settings';
import type { AiProvider } from '../types';
import type { LiveClient, LiveHandlers, LiveOptions } from './types';

/** Text that reads well aloud: no markdown, no place refs. */
export function forSpeech(t: string): string {
  return t
    .replace(/\(P\d+\)|\[P\d+\]/g, '')
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export class TurnLive implements LiveClient {
  readonly kind = 'turn' as const;
  private stopped = false;
  private working = false;
  private hearing = false;
  private talking = false;
  private quiet = false;
  private stopHear: (() => void) | null = null;
  private ctl: AbortController | null = null;
  private history: HistoryMsg[] = [];

  constructor(private provider: AiProvider, private o: LiveOptions, private h: LiveHandlers) {}

  async start() {
    this.h.onState('live');
    if (this.o.greeting) void this.turn(this.o.greeting, true);
  }

  talk() {
    if (this.stopped) return;
    if (this.talking) { stopSpeaking(); this.talking = false; }
    if (this.hearing) { this.stopHear?.(); return; }
    if (!speechSupported()) { this.h.onStep('이 브라우저는 음성 인식이 안 돼요. 아래 글자 입력을 써 주세요.'); return; }
    if (this.working) this.ctl?.abort();
    this.hearing = true;
    this.h.onCaption('user', '…', false);
    const l = listen('ko-KR', t => this.h.onCaption('user', t || '…', false));
    this.stopHear = l.stop;
    l.promise.then(t => {
      this.hearing = false;
      this.stopHear = null;
      this.h.onCaption('user', t, true);
      if (t && !this.stopped) void this.turn(t);
    }).catch(e => {
      this.hearing = false;
      this.stopHear = null;
      this.h.onCaption('user', '', true);
      this.h.onStep((e as Error).message === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성을 알아듣지 못했어요. 다시 눌러 말해 주세요.');
    });
  }

  private async turn(text: string, opening = false) {
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    this.working = true;
    try {
      const frame = await this.o.frame().catch(() => null);
      let draft = '';
      const r = await runAgent({
        provider: this.provider,
        model: settings().models[this.provider],
        system: this.o.instructions,
        history: this.history.slice(-8),
        text: opening ? text : `${contextBlock()}\n\n[질문] ${text}`,
        images: frame ? [{ mime: 'image/jpeg', b64: frame }] : undefined,
        tools: this.o.tools,
        maxTokens: 900,
        maxRounds: 4,
        signal: ctl.signal,
        onDraft: t => { draft = t; if (t) this.h.onCaption('ai', t, false); },
        onStep: s => this.h.onStep(s),
      });
      if (ctl.signal.aborted || this.stopped) return;
      const answer = (r.text || draft).trim();
      if (r.mapsSources.length) this.h.onSources(r.mapsSources);
      this.h.onCaption('ai', answer || '(답이 비어 있어요)', true);
      this.history.push({ role: 'user', text: opening ? '(카메라 안내를 켰어)' : text }, { role: 'assistant', text: answer });
      if (answer && !this.quiet && !this.stopped) {
        this.talking = true;
        await speak(forSpeech(answer));
        this.talking = false;
      }
    } catch (e) {
      if (!ctl.signal.aborted && !this.stopped) {
        this.h.onCaption('ai', '', true);
        this.h.onStep(aiErrorText(e));
      }
    } finally {
      if (this.ctl === ctl) { this.ctl = null; this.working = false; }
    }
  }

  sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    this.h.onCaption('user', t, true);
    void this.turn(t);
  }

  lookNow() {
    this.h.onCaption('user', '📷 지금 화면 봐 줘', true);
    void this.turn('지금 카메라 화면을 보고 어디로 가면 되는지 짧게 알려줘.');
  }

  /** In turn mode the microphone is push-to-talk, so "mute" silences the spoken answers. */
  setMuted(m: boolean) {
    this.quiet = m;
    if (m) { stopSpeaking(); this.talking = false; }
  }

  interrupt() {
    stopSpeaking();
    this.talking = false;
    this.ctl?.abort();
  }

  speaking() { return this.talking; }
  listening() { return this.hearing; }
  busy() { return this.working; }
  level() { return 0; }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ctl?.abort();
    this.stopHear?.();
    stopSpeaking();
    this.h.onState('ended');
  }
}
