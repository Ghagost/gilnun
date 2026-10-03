import type { AgentTool } from '../ai/agent';
import type { Source } from '../types';

export type LiveKind = 'gemini' | 'openai' | 'turn';
export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export type LiveOptions = {
  /** Model the user picked (only honoured with their own key; the server decides otherwise). */
  model?: string;
  voice: string;
  instructions: string;
  tools: AgentTool[];
  /** First user turn (context + "greet and give the first hint"), so the AI speaks first. */
  greeting?: string;
  /** JPEG (base64) of what the camera sees right now, or null when the camera is off. */
  frame: () => Promise<string | null>;
  /** Spend fewer frames (data saver). */
  saver?: boolean;
};

export type LiveHandlers = {
  onState: (s: LiveState, detail?: string) => void;
  /** Full text of the current line for that speaker; `final` closes the line. */
  onCaption: (who: 'user' | 'ai', text: string, final: boolean) => void;
  onStep: (text: string) => void;
  /** Google Maps sources that must be shown next to grounded answers. */
  onSources: (s: Source[]) => void;
};

export interface LiveClient {
  readonly kind: LiveKind;
  start(): Promise<void>;
  stop(): void;
  setMuted(m: boolean): void;
  /** Stop the AI talking. */
  interrupt(): void;
  sendText(text: string): void;
  /** Push the current camera view now and ask about it. */
  lookNow(): void;
  /** Push-to-talk (turn-based mode only). */
  talk?(): void;
  speaking(): boolean;
  /** Retry audio playback after a user tap (autoplay policies). */
  resumeAudio?(): void;
  listening?(): boolean;
  busy?(): boolean;
  /** Microphone input level 0..1. */
  level(): number;
}

export class LiveError extends Error {
  constructor(message: string, public code: 'auth' | 'rate' | 'network' | 'server' | 'permission' | 'unsupported' | 'other' = 'other') {
    super(message);
    this.name = 'LiveError';
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
