import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiProvider } from '../types';
import { localJSON } from './idb';
import { uid } from '../format';

export const DEFAULT_MODELS: Record<AiProvider, string> = { openai: 'gpt-6.1-sol', anthropic: 'claude-sonnet-5-5', gemini: 'gemini-3.8-flash' };
export const FAST_MODELS: Record<AiProvider, string> = { openai: 'gpt-6-luna', anthropic: 'claude-haiku-4-5', gemini: 'gemini-3.5-flash-lite' };
export const LIVE_MODELS = { openai: 'gpt-realtime-2.1', gemini: 'gemini-3.8-live' };

export const MODEL_CHOICES: Record<AiProvider, { id: string; label: string; note: string }[]> = {
  openai: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: '추천 · 빠르고 똑똑함' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: '최고 성능 · 느리고 비쌈' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: '가장 저렴·빠름' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '추천 · 속도와 성능 균형' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '복잡한 일정·추론' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: '가장 빠름' },
  ],
  gemini: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: '추천 · 무료 티어 있음' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', note: '안정적' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: '가장 저렴·빠름' },
  ],
};

export type Settings = {
  provider: AiProvider;
  models: Record<AiProvider, string>;
  keys: Record<AiProvider, string>;
  accessCode: string;
  googleKey: string;
  webSearch: boolean;
  thorough: boolean;
  voice: boolean;
  autoSec: number;
  mapLang: 'ko' | 'ja';
  theme: 'auto' | 'light' | 'dark';
  dataSaver: boolean;
  transitLayer: boolean;
  trafficLayer: boolean;
  openaiVoice: string;
  geminiVoice: string;
  fxManual: string;
  onboarded: boolean;
  notify: boolean;
  deviceId: string;
  forceFreeMap: boolean;
};

type SettingsStore = Settings & {
  set: (patch: Partial<Settings>) => void;
  setModel: (p: AiProvider, m: string) => void;
  setKey: (p: AiProvider, k: string) => void;
};

const DEFAULTS: Settings = {
  provider: 'gemini',
  models: { ...DEFAULT_MODELS },
  keys: { openai: '', anthropic: '', gemini: '' },
  accessCode: '',
  googleKey: '',
  webSearch: true,
  thorough: false,
  voice: true,
  autoSec: 10,
  mapLang: 'ko',
  theme: 'auto',
  dataSaver: false,
  transitLayer: true,
  trafficLayer: false,
  openaiVoice: 'marin',
  geminiVoice: 'Kore',
  fxManual: '',
  onboarded: false,
  notify: false,
  deviceId: '',
  forceFreeMap: false,
};

export const useSettings = create<SettingsStore>()(
  persist(
    set => ({
      ...DEFAULTS,
      set: patch => set(patch),
      setModel: (p, m) => set(s => ({ models: { ...s.models, [p]: m.trim() || DEFAULT_MODELS[p] } })),
      setKey: (p, k) => set(s => ({ keys: { ...s.keys, [p]: k.trim() } })),
    }),
    {
      name: 'gilnun.settings',
      version: 2,
      storage: localJSON,
      partialize: s => {
        const { set: _s, setModel: _m, setKey: _k, ...rest } = s;
        return rest;
      },
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<Settings>;
        return {
          ...current,
          ...p,
          models: { ...DEFAULT_MODELS, ...(p.models || {}) },
          keys: { ...DEFAULTS.keys, ...(p.keys || {}) },
          deviceId: p.deviceId || current.deviceId || uid('d'),
        };
      },
      onRehydrateStorage: () => state => {
        if (state && !state.deviceId) state.set({ deviceId: uid('d') });
      },
    },
  ),
);

/** Non-hook accessor for modules. */
export const settings = () => useSettings.getState();
