import { create } from 'zustand';
import type { AiProvider } from '../types';

export type ServerConfig = {
  ai: Record<AiProvider, boolean>;
  accessCodeRequired: boolean;
  google: { mapsKey: string | null; mapId: string | null; grounding: boolean };
  transit: boolean;
  limits: { perMinute: number; perDay: number };
  models: { openaiLive: string; geminiLive: string };
  version: string;
};

export type Weather = {
  current: { time: string; temp?: number; feels?: number; code?: number; precip?: number; wind?: number; humidity?: number };
  hours: { time: string; temp?: number; pop?: number; code?: number }[];
  days: { date: string; code?: number; max?: number; min?: number; pop?: number }[];
  at: number;
  for: { lat: number; lng: number };
};

export type Quake = { id: string; time: string; place: string; lat: number | null; lng: number | null; depth: number | null; magnitude: number | null; maxScale: number; scaleText: string; tsunami: string };

type RuntimeState = {
  config: ServerConfig | null;
  configError: boolean;
  engine: 'google' | 'maplibre' | null;
  googleState: 'off' | 'loading' | 'ready' | 'error';
  googleError: string | null;
  mapReady: boolean;
  online: boolean;
  fx: { rate: number; date: string; source: string; at: number } | null;
  weather: Weather | null;
  quakes: Quake[];
  quakeAt: number;
  dismissedQuake: string | null;
  installPrompt: unknown;
  set: (p: Partial<RuntimeState>) => void;
};

export const useRuntime = create<RuntimeState>()(set => ({
  config: null,
  configError: false,
  engine: null,
  googleState: 'off',
  googleError: null,
  mapReady: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  fx: null,
  weather: null,
  quakes: [],
  quakeAt: 0,
  dismissedQuake: null,
  installPrompt: null,
  set: p => set(p),
}));

export const runtime = () => useRuntime.getState();
