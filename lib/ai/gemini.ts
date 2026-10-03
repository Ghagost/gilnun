import { sseEvents, sseJson } from '../sse';
import type { Source } from '../types';
import { normalizeHistory } from './anthropic';
import { aiPost } from './transport';
import { AiError, type Callbacks, type JsonSchema, type ProviderSession, type RoundResult, type ToolCall, type ToolResult, type TurnInput } from './types';

type Obj = Record<string, any>;

const ALLOWED_SCHEMA_KEYS = new Set(['type', 'format', 'description', 'nullable', 'enum', 'properties', 'required', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'minLength', 'maxLength', 'title']);

/** Keeps only the OpenAPI-subset keywords Gemini function declarations accept. */
export function geminiSchema(s: JsonSchema | undefined): Obj | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const out: Obj = {};
  for (const [k, v] of Object.entries(s)) {
    if (!ALLOWED_SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, JsonSchema>).map(([pk, pv]) => [pk, geminiSchema(pv) || {}]));
    } else if (k === 'items') out.items = geminiSchema(v as JsonSchema) || {};
    else if (k === 'anyOf' && Array.isArray(v)) out.anyOf = v.map(x => geminiSchema(x as JsonSchema) || {});
    else if (k === 'enum' && Array.isArray(v)) out.enum = v.map(String);
    else out[k] = v;
  }
  if (out.type === 'object' && out.properties && !Object.keys(out.properties).length) delete out.properties;
  return out;
}

/** Appends a streamed part, merging plain text so thought signatures stay attached to their parts. */
export function mergePart(parts: Obj[], p: Obj) {
  const last = parts[parts.length - 1];
  const plainText = (x: Obj | undefined) => x && typeof x.text === 'string' && !x.thought && !x.thoughtSignature && Object.keys(x).every(k => k === 'text');
  if (plainText(p) && plainText(last)) { last.text += p.text; return; }
  parts.push({ ...p });
}

export class GeminiSession implements ProviderSession {
  readonly provider = 'gemini' as const;
  private model = '';
  private base: Obj = {};
  private contents: Obj[] = [];
  private lastCalls: { id?: string; name: string }[] = [];
  private extras = true;

  async start(input: TurnInput, cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    this.model = input.model;
    this.base = { systemInstruction: { parts: [{ text: input.system }] } };
    if (input.tools.length) {
      this.base.tools = [{ functionDeclarations: input.tools.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }];
    }
    const gc: Obj = { maxOutputTokens: input.maxTokens ?? 4000 };
    if (input.json && !input.tools.length) gc.responseMimeType = 'application/json';
    gc.thinkingConfig = { thinkingLevel: input.thorough ? 'medium' : 'low' };
    this.base.generationConfig = gc;
    const parts: Obj[] = (input.user.images || []).map(im => ({ inlineData: { mimeType: im.mime, data: im.b64 } }));
    parts.push({ text: input.user.text });
    const hist = normalizeHistory(input.history).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
    if (hist.length && hist[hist.length - 1].role === 'user') {
      // Keep roles alternating: fold a dangling user turn into the new message.
      const prev = hist.pop()!;
      parts.unshift({ text: prev.parts[0].text });
    }
    this.contents = [...hist, { role: 'user', parts }];
    return this.request(cb, signal);
  }

  async continue(results: ToolResult[], cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    if (!results.length) throw new AiError('bad_request', 'nothing to continue');
    this.contents.push({
      role: 'user',
      parts: results.map(r => {
        const call = this.lastCalls.find(c => (c.id ? c.id === r.id : false)) || this.lastCalls.find(c => c.name === r.name);
        const response = r.output && typeof r.output === 'object' && !Array.isArray(r.output) ? r.output : { result: r.output };
        return { functionResponse: { name: r.name, ...(call?.id ? { id: call.id } : {}), response } };
      }),
    });
    return this.request(cb, signal);
  }

  private async request(cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    const body: Obj = { ...this.base, contents: this.contents };
    if (!this.extras && body.generationConfig) { body.generationConfig = { ...body.generationConfig }; delete body.generationConfig.thinkingConfig; }
    let res: Response;
    try {
      res = await aiPost('gemini', `models/${this.model}:streamGenerateContent`, body, signal, '?alt=sse');
    } catch (e) {
      if (e instanceof AiError && e.status === 400 && this.extras && /thinking/i.test(e.message)) {
        this.extras = false;
        return this.request(cb, signal);
      }
      throw e;
    }
    return this.read(res, cb);
  }

  private async read(res: Response, cb: Callbacks): Promise<RoundResult> {
    if (!res.body) throw new AiError('server', 'empty response');
    const parts: Obj[] = [];
    let finish = '';
    const sources: Source[] = [];
    let blocked = '';
    for await (const ev of sseEvents(res.body)) {
      const d = sseJson<Obj>(ev.data);
      if (!d) continue;
      if (d.error) throw new AiError(d.error.code === 429 ? 'rate' : 'server', d.error.message || 'Gemini 오류');
      if (d.promptFeedback?.blockReason) blocked = d.promptFeedback.blockReason;
      const cand = d.candidates?.[0];
      if (!cand) continue;
      for (const p of cand.content?.parts || []) {
        if (typeof p.text === 'string' && !p.thought && p.text) cb.onText?.(p.text);
        mergePart(parts, p);
      }
      if (cand.finishReason) finish = cand.finishReason;
      for (const c of cand.groundingMetadata?.groundingChunks || []) if (c.web?.uri) sources.push({ url: c.web.uri, title: c.web.title });
    }
    if (!parts.length) {
      if (blocked || /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(finish)) throw new AiError('content', `blocked: ${blocked || finish}`);
      if (finish === 'MAX_TOKENS') return { text: '', toolCalls: [], sources, stop: 'length' };
      throw new AiError('server', `응답이 비어 있어요 (${finish || 'EMPTY'})`);
    }
    this.contents.push({ role: 'model', parts });
    const toolCalls: ToolCall[] = [];
    this.lastCalls = [];
    parts.forEach((p, i) => {
      if (p.functionCall?.name) {
        const id = p.functionCall.id || `${p.functionCall.name}#${i}`;
        toolCalls.push({ id, name: p.functionCall.name, args: p.functionCall.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {} });
        this.lastCalls.push({ id: p.functionCall.id, name: p.functionCall.name });
      }
    });
    const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    const stop: RoundResult['stop'] = toolCalls.length ? 'tool' : finish === 'MAX_TOKENS' ? 'length' : 'end';
    return { text, toolCalls, sources, stop };
  }
}

/** One-off grounded answer with Google Search (used as a function tool for Gemini). */
export async function geminiWebSearch(model: string, query: string, signal?: AbortSignal): Promise<{ answer: string; sources: Source[] }> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: `다음을 최신 웹 정보로 확인해서 한국어로 5문장 이내로 답해. 출처가 불확실하면 그렇다고 말해.\n\n${query}` }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: 1200 },
  };
  const r = await aiPost('gemini', `models/${model}:generateContent`, body, signal);
  const j = (await r.json()) as Obj;
  const cand = j.candidates?.[0];
  const answer = (cand?.content?.parts || []).filter((p: Obj) => typeof p.text === 'string' && !p.thought).map((p: Obj) => p.text).join('').trim();
  const sources: Source[] = (cand?.groundingMetadata?.groundingChunks || []).map((c: Obj) => c.web).filter(Boolean).map((w: Obj) => ({ url: w.uri, title: w.title }));
  return { answer: answer || '검색 결과를 찾지 못했어요.', sources };
}
