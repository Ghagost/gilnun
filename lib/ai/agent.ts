import type { AiProvider, Source } from '../types';
import { AnthropicSession } from './anthropic';
import { GeminiSession } from './gemini';
import { OpenAiSession } from './openai';
import { AiError, type HistoryMsg, type ImageInput, type ProviderSession, type ToolCall, type ToolDef, type ToolResult, type TurnInput } from './types';

export type ToolContext = {
  signal?: AbortSignal;
  step: (s: string) => void;
  /** Collect place refs the tool put on the map. */
  pinned: string[];
  /** Google Maps sources that must be shown with the answer. */
  mapsSources: Source[];
  /** Web sources found by tools. */
  sources: Source[];
  /** First tool call in this turn clears old pins. */
  fresh: boolean;
};

export type AgentTool = ToolDef & {
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export function createSession(p: AiProvider): ProviderSession {
  if (p === 'openai') return new OpenAiSession();
  if (p === 'anthropic') return new AnthropicSession();
  return new GeminiSession();
}

export type AgentRun = {
  provider: AiProvider;
  model: string;
  system: string;
  history: HistoryMsg[];
  text: string;
  images?: ImageInput[];
  tools: AgentTool[];
  webSearch?: TurnInput['webSearch'];
  thorough?: boolean;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
  maxRounds?: number;
  /** Text of the current round as it streams (resets when a tool round starts). */
  onDraft?: (text: string) => void;
  onStep?: (step: string) => void;
};

export type AgentResult = { text: string; sources: Source[]; mapsSources: Source[]; pinned: string[]; steps: string[]; rounds: number; truncated: boolean };

async function execTool(tools: AgentTool[], call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const t = tools.find(x => x.name === call.name);
  if (!t) return { id: call.id, name: call.name, output: { error: `unknown tool: ${call.name}` }, isError: true };
  try {
    const out = await t.run(call.args || {}, ctx);
    return { id: call.id, name: call.name, output: out ?? { ok: true } };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    return { id: call.id, name: call.name, output: { error: String((e as Error)?.message || e).slice(0, 300) }, isError: true };
  }
}

/** Runs a tool-using conversation turn against any provider. */
export async function runAgent(o: AgentRun, session: ProviderSession = createSession(o.provider)): Promise<AgentResult> {
  const steps: string[] = [];
  const step = (s: string) => { steps.push(s); o.onStep?.(s); };
  const ctx: ToolContext = { signal: o.signal, step, pinned: [], mapsSources: [], sources: [], fresh: true };
  let draft = '';
  const cb = {
    onText: (d: string) => { draft += d; o.onDraft?.(draft); },
    onStep: step,
  };
  const input: TurnInput = {
    system: o.system, history: o.history, user: { text: o.text, images: o.images }, tools: o.tools,
    webSearch: o.webSearch, model: o.model, thorough: o.thorough, maxTokens: o.maxTokens, json: o.json,
  };
  const allSources: Source[] = [];
  let r = await session.start(input, cb, o.signal);
  allSources.push(...r.sources);
  let rounds = 1;
  const maxRounds = o.maxRounds ?? 7;
  let lastText = r.text;
  while (rounds < maxRounds) {
    if (o.signal?.aborted) throw new AiError('cancelled', '멈췄어요.');
    if (r.stop === 'pause') {
      draft = '';
      r = await session.continue([], cb, o.signal);
    } else if (r.stop === 'tool' && r.toolCalls.length) {
      const results = await Promise.all(r.toolCalls.map(c => execTool(o.tools, c, ctx)));
      draft = '';
      o.onDraft?.('');
      r = await session.continue(results, cb, o.signal);
    } else break;
    rounds++;
    allSources.push(...r.sources);
    if (r.text.trim()) lastText = r.text;
  }
  const truncated = rounds >= maxRounds && (r.stop === 'tool' || r.stop === 'pause');
  const text = (r.text.trim() ? r.text : lastText).trim();
  const seen = new Set<string>();
  const sources = [...allSources, ...ctx.sources].filter(s => s.url && !seen.has(s.url) && seen.add(s.url));
  return { text, sources, mapsSources: ctx.mapsSources, pinned: ctx.pinned, steps, rounds, truncated };
}
