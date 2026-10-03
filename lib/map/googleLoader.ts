import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let loading: Promise<void> | null = null;
let loadedWith: string | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

declare global {
  interface Window { gm_authFailure?: () => void }
}

/**
 * Loads the Maps JavaScript API once (maps, marker, places). Language is fixed per page load,
 * so changing it needs a reload. Rejects on network failure, timeout or an invalid key.
 */
export function loadGoogleMaps(key: string, language: 'ko' | 'ja', mapId?: string | null, timeoutMs = 20000): Promise<void> {
  const sig = `${key}|${language}|${mapId || ''}`;
  if (loading && loadedWith === sig) return loading;
  if (loading && loadedWith !== sig) return Promise.reject(new Error('reload_required'));
  loadedWith = sig;
  window.gm_authFailure = () => {
    authFailed = true;
    authListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  };
  setOptions({ key, v: 'weekly', language, region: 'JP', authReferrerPolicy: 'origin', ...(mapId ? { mapIds: [mapId] } : {}) } as Parameters<typeof setOptions>[0]);
  const load = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('places')]).then(() => {
    if (authFailed) throw new Error('auth_failed');
  });
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
  loading = Promise.race([load, timeout]);
  loading.catch(() => { /* surfaced to callers */ });
  return loading;
}

export function onGoogleAuthFailure(cb: () => void): () => void {
  authListeners.add(cb);
  if (authFailed) cb();
  return () => { authListeners.delete(cb); };
}

export function googleAuthFailed() {
  return authFailed;
}

export async function loadRoutesLibrary(): Promise<boolean> {
  try { await importLibrary('routes'); return true; } catch { return false; }
}

export function googleReady(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { google?: { maps?: { places?: unknown } } }).google?.maps?.places && !authFailed;
}
