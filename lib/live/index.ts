import type { AiProvider } from '../types';
import { GeminiLive } from './gemini';
import { OpenAiLive } from './openai';
import { TurnLive } from './turn';
import type { LiveClient, LiveHandlers, LiveOptions } from './types';

export const LIVE_LABEL: Record<AiProvider, string> = { gemini: 'Gemini Live', openai: 'ChatGPT 실시간', anthropic: 'Claude 대화형' };
export const LIVE_NOTE: Record<AiProvider, string> = {
  gemini: '말하면서 영상을 계속 보여줘요. 끼어들어 말해도 돼요.',
  openai: '말하면 바로 대답하고, 말할 때마다 카메라 화면을 같이 보내요.',
  anthropic: '버튼을 눌러 말하면 그때 화면을 보고 대답해요 (실시간 음성 대신 차례로 대화).',
};

export function createLive(p: AiProvider, o: LiveOptions, h: LiveHandlers): LiveClient {
  if (p === 'gemini') return new GeminiLive(o, h);
  if (p === 'openai') return new OpenAiLive(o, h);
  return new TurnLive(p, o, h);
}

export type { LiveClient, LiveHandlers, LiveOptions, LiveState } from './types';
