import { sseEvents, sseJson } from '../sse';
import type { Source } from '../types';
import { aiPost } from './transport';
import { AiError, type Callbacks, type HistoryMsg, type ProviderSession, type RoundResult, type ToolCall, type ToolResult, type TurnInput } from './types';

type Obj = Record<string, any>;

/** Merges consecutive same-role turns and makes sure the list starts with a user turn. */
export function normalizeHistory(history: HistoryMsg[]): HistoryMsg[] {
  const out: HistoryMsg[] = [];
  for (const m of history) {
    const text = m.text?.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += '\n\n' + text;
    else out.push({ role: m.role, text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const supportsEffort = (m: string) => /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|fable|mythos)/.test(m);

export class AnthropicSession implements ProviderSession {
  readonly provider = 'anthropic' as const;
  private base: Obj = {};
  private messages: Obj[] = [];
  private lastContent: Obj[] = [];
  private lastStop = '';
  private extras = true;

  async start(input: TurnInput, cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    const tools: Obj[] = input.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (input.webSearch) {
      const loc: Obj = { type: 'approximate', country: input.webSearch.country || 'JP', timezone: input.webSearch.timezone || 'Asia/Tokyo' };
      if (input.webSearch.city) loc.city = input.webSearch.city;
      tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: loc });
    }
    this.base = { model: input.model, max_tokens: input.maxTokens ?? 4000, system: input.system, stream: true };
    if (tools.length) this.base.tools = tools;
    if (supportsEffort(input.model)) this.base.output_config = { effort: input.thorough ? 'medium' : 'low' };
    if (/^claude-sonnet-5-5/.test(input.model) && !input.thorough) this.base.thinking = { type: 'between_tools' };
    const content: Obj[] = (input.user.images || []).map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }));
    let userText = input.user.text;
    if (input.json) userText += '\n\n반드시 JSON 객체 하나만 출력해.';
    content.push({ type: 'text', text: userText });
    this.messages = [...normalizeHistory(input.history).map(m => ({ role: m.role, content: m.text })), { role: 'user', content }];
    // History may end with a user turn (e.g. a failed answer); merge so roles alternate.
    for (let i = this.messages.length - 2; i >= 0; i--) {
      const a = this.messages[i], b = this.messages[i + 1];
      if (a.role === 'user' && b.role === 'user') {
        const ac = typeof a.content === 'string' ? [{ type: 'text', text: a.content }] : a.content;
        b.content = [...ac, ...(typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : b.content)];
        this.messages.splice(i, 1);
      }
    }
    return this.request(cb, signal);
  }

  async continue(results: ToolResult[], cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    this.messages.push({ role: 'assistant', content: this.lastContent });
    if (results.length) {
      this.messages.push({
        role: 'user',
        content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output), ...(r.isError ? { is_error: true } : {}) })),
      });
    } else if (this.lastStop !== 'pause_turn') {
      throw new AiError('bad_request', 'nothing to continue');
    }
    return this.request(cb, signal);
  }

  private async request(cb: Callbacks, signal?: AbortSignal): Promise<RoundResult> {
    const body: Obj = { ...this.base, messages: this.messages };
    if (!this.extras) { delete body.output_config; delete body.thinking; }
    let res: Response;
    try {
      res = await aiPost('anthropic', 'messages', body, signal);
    } catch (e) {
      if (e instanceof AiError && e.status === 400 && this.extras && /thinking|effort|output_config/i.test(e.message)) {
        this.extras = false;
        return this.request(cb, signal);
      }
      throw e;
    }
    return this.read(res, cb);
  }

  private async read(res: Response, cb: Callbacks): Promise<RoundResult> {
    if (!res.body) throw new AiError('server', 'empty response');
    const blocks: Obj[] = [];
    let stop = '';
    for await (const ev of sseEvents(res.body)) {
      const d = sseJson<Obj>(ev.data);
      if (!d) continue;
      switch (d.type) {
        case 'content_block_start': {
          const b = structuredClone(d.content_block || {});
          if (b.type === 'tool_use' || b.type === 'server_tool_use') { b._json = ''; }
          blocks[d.index] = b;
          if (b.type === 'server_tool_use' && b.name === 'web_search') cb.onStep?.('웹 검색 중…');
          break;
        }
        case 'content_block_delta': {
          const b = blocks[d.index];
          const dl = d.delta || {};
          if (!b) break;
          if (dl.type === 'text_delta') { b.text = (b.text || '') + dl.text; cb.onText?.(dl.text); }
          else if (dl.type === 'input_json_delta') b._json = (b._json || '') + (dl.partial_json || '');
          else if (dl.type === 'thinking_delta') b.thinking = (b.thinking || '') + (dl.thinking || '');
          else if (dl.type === 'signature_delta') b.signature = dl.signature;
          else if (dl.type === 'citations_delta' && dl.citation) (b.citations ||= []).push(dl.citation);
          break;
        }
        case 'content_block_stop': {
          const b = blocks[d.index];
          if (b && '_json' in b) {
            let input: Obj = {};
            try { input = b._json ? JSON.parse(b._json) : (b.input && Object.keys(b.input).length ? b.input : {}); } catch { input = {}; }
            b.input = input;
            delete b._json;
            if (b.type === 'server_tool_use' && b.name === 'web_search' && input.query) cb.onStep?.(`웹 검색: ${input.query}`);
          }
          break;
        }
        case 'message_delta':
          if (d.delta?.stop_reason) stop = d.delta.stop_reason;
          break;
        case 'error': {
          const msg = d.error?.message || 'Claude 오류';
          throw new AiError(d.error?.type === 'overloaded_error' ? 'server' : /rate/i.test(d.error?.type || '') ? 'rate' : 'server', msg);
        }
      }
    }
    // Any block still holding raw JSON (stream ended early) gets parsed best-effort.
    for (const b of blocks) if (b && '_json' in b) { try { b.input = JSON.parse(b._json || '{}'); } catch { b.input = {}; } delete b._json; }
    this.lastContent = blocks.filter(Boolean);
    this.lastStop = stop;
    let text = '';
    const sources: Source[] = [];
    const toolCalls: ToolCall[] = [];
    for (const b of this.lastContent) {
      if (b.type === 'text') {
        text += b.text || '';
        for (const c of b.citations || []) if (c.url) sources.push({ url: c.url, title: c.title });
      } else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input || {} });
    }
    if (stop === 'refusal') return { text: text || '이 요청에는 답할 수 없어요.', toolCalls: [], sources, stop: 'refusal' };
    const s: RoundResult['stop'] = stop === 'tool_use' ? 'tool' : stop === 'pause_turn' ? 'pause' : stop === 'max_tokens' ? 'length' : stop === 'end_turn' || stop === 'stop_sequence' ? 'end' : 'other';
    return { text, toolCalls: s === 'tool' ? toolCalls : [], sources, stop: s };
  }
}
