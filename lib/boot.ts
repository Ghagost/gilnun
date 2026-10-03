import { api } from './api';
import { configureTransport } from './ai/transport';
import { distance } from './geo';
import { decodeShare } from './share';
import { geo } from './store/geo';
import { runtime, type Quake, type ServerConfig, type Weather } from './store/runtime';
import { settings } from './store/settings';
import { ui } from './store/ui';
import type { AiProvider } from './types';

export const FALLBACK_CONFIG: ServerConfig = {
  ai: { openai: false, anthropic: false, gemini: false },
  accessCodeRequired: false,
  google: { mapsKey: null, mapId: null, grounding: false },
  transit: false,
  limits: { perMinute: 0, perDay: 0 },
  models: { openaiLive: 'gpt-realtime-2.1', geminiLive: 'gemini-3.8-live' },
  version: 'offline',
};

export function wireTransport() {
  configureTransport({
    headers: (p: AiProvider | 'app') => {
      const s = settings();
      const h: Record<string, string> = {};
      if (s.deviceId) h['x-device-id'] = s.deviceId;
      if (s.accessCode) h['x-access-code'] = s.accessCode;
      if (p !== 'app' && s.keys[p]) h['x-user-key'] = s.keys[p];
      return h;
    },
  });
}

export async function loadConfig() {
  try {
    const c = await api<ServerConfig>('/api/config', { timeout: 8000 });
    runtime().set({ config: c, configError: false });
    try { localStorage.setItem('gilnun.config', JSON.stringify(c)); } catch { /* ignore */ }
  } catch {
    let cached: ServerConfig | null = null;
    try { cached = JSON.parse(localStorage.getItem('gilnun.config') || 'null'); } catch { /* ignore */ }
    runtime().set({ config: cached || FALLBACK_CONFIG, configError: true });
  }
}

export async function loadFx() {
  try {
    const c = JSON.parse(localStorage.getItem('gilnun.fx') || 'null');
    if (c?.rate) runtime().set({ fx: c });
    if (c?.at && Date.now() - c.at < 6 * 3600e3) return;
  } catch { /* ignore */ }
  try {
    const j = await api<{ rate: number; date: string; source: string }>('/api/fx', { timeout: 9000 });
    const fx = { ...j, at: Date.now() };
    runtime().set({ fx });
    try { localStorage.setItem('gilnun.fx', JSON.stringify(fx)); } catch { /* ignore */ }
  } catch { /* keep cached/default */ }
}

let wxBusy = false;
export async function loadWeather(force = false) {
  const me = geo().me;
  const w = runtime().weather;
  const at = me ? { lat: me.lat, lng: me.lng } : null;
  if (!at || wxBusy) return;
  if (!force && w && Date.now() - w.at < 30 * 60000 && distance(w.for, at) < 5000) return;
  wxBusy = true;
  try {
    const j = await api<Omit<Weather, 'at' | 'for'>>(`/api/weather?lat=${at.lat.toFixed(3)}&lng=${at.lng.toFixed(3)}`, { timeout: 9000 });
    runtime().set({ weather: { ...j, at: Date.now(), for: at } });
  } catch { /* offline */ } finally { wxBusy = false; }
}

export async function loadQuakes() {
  try {
    const j = await api<{ quakes: Quake[] }>('/api/quake', { timeout: 8000 });
    runtime().set({ quakes: j.quakes || [], quakeAt: Date.now() });
  } catch { /* offline */ }
}

/** A quake worth a banner: strong anywhere (shindo 5- or more) or noticeable near the user, within 60 min. */
export function alertQuake(quakes: Quake[], now = Date.now()): Quake | null {
  const me = geo().me;
  for (const q of quakes) {
    const t = Date.parse(q.time);
    if (!Number.isFinite(t) || now - t > 60 * 60000) continue;
    const near = me && q.lat != null && q.lng != null ? distance(me, { lat: q.lat, lng: q.lng }) < 350000 : false;
    if (q.maxScale >= 45 || (q.maxScale >= 30 && near)) return q;
  }
  return null;
}

export async function handleLaunchParams() {
  const url = new URL(location.href);
  const tab = url.searchParams.get('tab');
  if (tab === 'ai' || tab === 'booking' || tab === 'trip' || tab === 'tools') ui().setTab(tab);
  if (url.searchParams.get('open') === 'camera') ui().open({ type: 'camera' });
  const m = /[#&]trip=([A-Za-z0-9_-]+)/.exec(url.hash);
  if (m) {
    const data = await decodeShare(m[1]);
    if (data) ui().open({ type: 'import', token: m[1] });
  }
  if (url.search || url.hash) history.replaceState(history.state, '', url.pathname);
}

export function registerSW() {
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
  navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
    // The first visit loads before the worker exists: hand it the app's own files so the next offline start works.
    const urls = performance.getEntriesByType('resource').map(e => e.name)
      .filter(u => u.startsWith(location.origin) && /\/_next\/static\/|\/fonts\//.test(u));
    reg.active?.postMessage({ type: 'cache-urls', urls: [...new Set(urls)].slice(0, 300) });
  }).catch(() => { /* optional */ });
}
