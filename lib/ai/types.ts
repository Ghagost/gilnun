import type { AiProvider, Source } from '../types';

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: (string | number)[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  [k: string]: unknown;
};

export type ToolDef = { name: string; description: string; parameters: JsonSchema };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ToolResult = { id: string; name: string; output: unknown; isError?: boolean };
export type ImageInput = { mime: string; b64: string };
export type HistoryMsg = { role: 'user' | 'assistant'; text: string };

export type TurnInput = {
  system: string;
  history: HistoryMsg[];
  user: { text: string; images?: ImageInput[] };
  tools: ToolDef[];
  /** Provider-native web search (Claude / OpenAI). */
  webSearch?: { country?: string; city?: string; timezone?: string } | null;
  model: string;
  thorough?: boolean;
  maxTokens?: number;
  /** Ask for a single JSON object as the answer. */
  json?: boolean;
};

export type Callbacks = {
  onText?: (delta: string) => void;
  onStep?: (step: string) => void;
};

export type RoundResult = {
  text: string;
  toolCalls: ToolCall[];
  sources: Source[];
  stop: 'end' | 'tool' | 'length' | 'pause' | 'refusal' | 'other';
};

export interface ProviderSession {
  readonly provider: AiProvider;
  start(input: TurnInput, cb: Callbacks, signal?: AbortSignal): Promise<RoundResult>;
  /** Sends tool results (or resumes a paused turn when `results` is empty). */
  continue(results: ToolResult[], cb: Callbacks, signal?: AbortSignal): Promise<RoundResult>;
}

export type AiErrorCode = 'no_key' | 'access_code' | 'auth' | 'rate' | 'model' | 'bad_request' | 'server' | 'network' | 'cancelled' | 'content' | 'too_large';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string, public status?: number) { super(message); this.name = 'AiError'; }
}

export const PROVIDER_LABEL: Record<AiProvider, string> = { openai: 'ChatGPT', anthropic: 'Claude', gemini: 'Gemini' };
