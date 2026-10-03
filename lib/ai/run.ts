import { uid } from '../format';
import { mapApi } from '../map/instance';
import { chat } from '../store/chat';
import { geo } from '../store/geo';
import { placeByRef } from '../store/places';
import { runtime } from '../store/runtime';
import { settings, FAST_MODELS } from '../store/settings';
import type { AiProvider } from '../types';
import { runAgent } from './agent';
import { chatSystem, contextBlock } from './prompts';
import { buildTools } from './tools';
import { aiErrorText } from './transport';
import { AiError, type HistoryMsg, type ImageInput } from './types';

/** True when this provider can be used (server key or the user's own key). */
export function providerAvailable(p: AiProvider): boolean {
  return !!settings().keys[p] || !!runtime().config?.ai?.[p];
}

export function effectiveProvider(): AiProvider | null {
  const pref = settings().provider;
  if (providerAvailable(pref)) return pref;
  return (['gemini', 'openai', 'anthropic'] as AiProvider[]).find(providerAvailable) || null;
}

let ctl: AbortController | null = null;

export function stopChat() {
  ctl?.abort();
}

function history(): HistoryMsg[] {
  return chat().messages
    .filter(m => !m.pending && !m.error && m.text.trim())
    .slice(-12)
    .map(m => ({ role: m.role, text: m.role === 'user' && m.image ? `(사진 첨부) ${m.text}` : m.text }));
}

export async function sendChat(text: string, image?: ImageInput | null): Promise<void> {
  text = text.trim();
  if (!text && !image) return;
  const provider = effectiveProvider();
  const s = settings();
  const hist = history();
  chat().add({ id: uid('m'), role: 'user', text: text || '(사진)', image: image || null, createdAt: Date.now() });
  const aiId = uid('m');
  if (!provider) {
    chat().add({ id: aiId, role: 'assistant', text: '', error: 'AI 키가 아직 없어요. 설정 → AI에서 Gemini(무료 티어)·ChatGPT·Claude 중 하나의 키를 넣거나, 서버에 키를 설정해 주세요. 그 전에도 지도 검색·주변 찾기·일정·예약 기능은 모두 쓸 수 있어요.', createdAt: Date.now() });
    return;
  }
  ctl?.abort();
  const my = new AbortController();
  ctl = my;
  const model = s.models[provider];
  chat().add({ id: aiId, role: 'assistant', text: '', pending: true, steps: [], provider, model, createdAt: Date.now() });
  chat().setBusy(true);
  const steps: string[] = [];
  try {
    const res = await runAgent({
      provider, model,
      system: chatSystem(),
      history: hist,
      text: `${contextBlock()}\n\n[질문]\n${text || '이 사진이 뭔지, 여행자에게 필요한 걸 알려줘.'}`,
      images: image ? [image] : undefined,
      tools: buildTools(),
      webSearch: s.webSearch && provider !== 'gemini' ? { country: 'JP', city: geo().area?.city || undefined, timezone: 'Asia/Tokyo' } : null,
      thorough: s.thorough,
      maxTokens: 3500,
      signal: my.signal,
      onDraft: t => chat().patch(aiId, { text: t }),
      onStep: st => { steps.push(st); chat().patch(aiId, { steps: [...steps] }); },
    });
    const text2 = res.text || (res.truncated ? '도구를 너무 많이 써서 여기서 멈췄어요. 질문을 조금 좁혀 주세요.' : '(답변이 비어 있어요)');
    chat().patch(aiId, { text: text2, pending: false, refs: [...new Set(res.pinned)], sources: res.sources, mapsSources: res.mapsSources, steps });
    const pts = [...new Set(res.pinned)].map(r => placeByRef(r)).filter(Boolean).map(p => ({ lat: p!.lat, lng: p!.lng }));
    if (pts.length) mapApi.fit(pts);
  } catch (e) {
    const cancelled = (e instanceof AiError && e.code === 'cancelled') || (e as Error)?.name === 'AbortError';
    const cur = chat().messages.find(m => m.id === aiId);
    chat().patch(aiId, { pending: false, steps, error: cancelled ? (cur?.text ? undefined : '멈췄어요.') : aiErrorText(e) });
  } finally {
    if (ctl === my) { ctl = null; chat().setBusy(false); }
  }
}

/** One-shot, tool-free call (translation, scripts, extraction). Uses the fast model unless told otherwise. */
export async function quickAsk(prompt: string, opts: { images?: ImageInput[]; json?: boolean; fast?: boolean; signal?: AbortSignal; maxTokens?: number; onDraft?: (t: string) => void } = {}): Promise<string> {
  const provider = effectiveProvider();
  if (!provider) throw new AiError('no_key', 'no provider');
  const s = settings();
  const model = opts.fast === false ? s.models[provider] : FAST_MODELS[provider];
  const res = await runAgent({
    provider, model, system: '너는 일본 여행 중인 한국인을 돕는 정확하고 간결한 비서야.', history: [], text: prompt, images: opts.images, tools: [],
    json: opts.json, maxTokens: opts.maxTokens ?? 1500, signal: opts.signal, onDraft: opts.onDraft,
  });
  return res.text;
}
