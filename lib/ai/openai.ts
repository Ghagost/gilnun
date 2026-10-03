import { sseEvents, sseJson } from '../sse';
import type { Source } from '../types';
import { aiPost } from './transport';
import { AiError, type Callbacks, type ProviderSession, type RoundResult, type ToolCall, type ToolResult, type TurnInput } from './types';

type Obj = Record<string, any>;

export class OpenAiSession implements ProviderSession {
  readonly provider = 'openai' as const;
  private base: Obj = {};
  private lastId: string | null = null;
  private extras = true;

  private buildTools(input: TurnInput): Obj[] {
    const tools: Obj[] = input.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    if (input.webSearch) {
      const loc: Obj = { type: 'approximate', country: input.webSearch.country || 'JP', timezone: input.webSearch.timezone || 'Asia/Tokyo' };
      if (input.webSearch.city) loc.city = input.webSearch.city;
      tools.push({ type: 'web_search', user_location: loc });
    }
    return tools;
  }

  async start(input: TurnInput, cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    const content: Obj[] = [{ type: 'input_text', text: input.user.text }];
    for (const im of input.user.images || []) content.push({ type: 'input_image', image_url: `data:${im.mime};base64,${im.b64}` });
    const history = input.history.filter(m => m.text.trim()).map(m => ({ role: m.role, content: m.text }));
    this.base = {
      model: input.model,
      instructions: input.system,
      tools: this.buildTools(input),
      max_output_tokens: input.maxTokens ?? 4000,
      store: true,
      stream: true,
      reasoning: { effort: input.thorough ? 'medium' : 'low' },
    };
    if (input.json) this.base.text = { format: { type: 'json_object' } };
    if (!this.base.tools.length) delete this.base.tools;
    return this.request({ input: [...history, { role: 'user', content }] }, cb, signal);
  }

  async continue(results: ToolResult[], cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    if (!this.lastId) throw new AiError('bad_request', 'no previous response');
    const input = results.map(r => ({ type: 'function_call_output', call_id: r.id, output: typeof r.output === 'string' ? r.output : JSON.stringify(r.output) }));
    return this.request({ previous_response_id: this.lastId, input }, cb, signal);
  }

  private async request(part: Obj, cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    const body = { ...this.base, ...part };
    if (!this.extras) { delete body.reasoning; delete body.text; }
    let res: Response;
    try {
      res = await aiPost('openai', 'responses', body, signal);
    } catch (e) {
      if (e instanceof AiError && e.status === 400 && this.extras && /reasoning|effort|text\.format|json_object/i.test(e.message)) {
        this.extras = false;
        return this.request(part, cb, signal);
      }
      throw e;
    }
    return this.read(res, cb);
  }

  private async read(res: Response, cb: Callbacks): Promise<RoundResult> {
    if (!res.body) throw new AiError('server', 'empty response');
    let text = '';
    let final: Obj | null = null;
    const calls = new Map<string, ToolCall>();
    for await (const ev of sseEvents(res.body)) {
      const d = sseJson<Obj>(ev.data);
      if (!d) continue;
      const type = d.type || ev.event;
      if (type === 'response.created' && d.response?.id) this.lastId = d.response.id;
      else if (type === 'response.output_text.delta' && typeof d.delta === 'string') { text += d.delta; cb.onText?.(d.delta); }
      else if (type === 'response.output_item.added' && d.item?.type === 'web_search_call') cb.onStep?.('웹 검색 중…');
      else if (type === 'response.output_item.done' && d.item?.type === 'function_call') {
        const it = d.item;
        calls.set(it.call_id, { id: it.call_id, name: it.name, args: parseArgs(it.arguments) });
      } else if (type === 'response.completed' || type === 'response.incomplete') final = d.response;
      else if (type === 'response.failed') throw new AiError('server', d.response?.error?.message || 'OpenAI 응답 실패');
      else if (type === 'error') {
        const msg = d.error?.message || d.message || 'OpenAI 오류';
        throw new AiError(/rate|limit/i.test(msg) ? 'rate' : 'server', msg);
      }
    }
    const sources: Source[] = [];
    if (final) {
      if (final.id) this.lastId = final.id;
      let finalText = '';
      for (const item of final.output || []) {
        if (item.type === 'message') {
          for (const c of item.content || []) {
            if (c.type === 'output_text') {
              finalText += c.text || '';
              for (const a of c.annotations || []) if (a.type === 'url_citation' && a.url) sources.push({ url: a.url, title: a.title });
            } else if (c.type === 'refusal') finalText += c.refusal || '';
          }
        } else if (item.type === 'function_call' && !calls.has(item.call_id)) {
          calls.set(item.call_id, { id: item.call_id, name: item.name, args: parseArgs(item.arguments) });
        }
      }
      if (finalText) text = finalText;
    }
    const toolCalls = [...calls.values()];
    let stop: RoundResult['stop'] = toolCalls.length ? 'tool' : 'end';
    if (final?.status === 'incomplete') stop = toolCalls.length ? 'tool' : 'length';
    return { text, toolCalls, sources, stop };
  }
}

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
