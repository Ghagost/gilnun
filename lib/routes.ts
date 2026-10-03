import { api } from './api';
import { distance, walkMinutes, type LatLng } from './geo';
import { isoDate, fmtHM } from './format';
import { loadRoutesLibrary } from './map/googleLoader';
import { googleActive } from './places';
import type { TransitRoute } from './types';

export type SimpleRoute = { minutes: number; meters: number; path: LatLng[]; source: 'google' | 'estimate'; steps?: string[] };

/** Japanese transit routes from the server (NAVITIME). */
export async function transitRoutes(from: LatLng, to: LatLng, at: Date, type: 'depart' | 'arrive' | 'first' | 'last' = 'depart', signal?: AbortSignal): Promise<TransitRoute[]> {
  const when = `${isoDate(at)}T${fmtHM(at)}`;
  const q = new URLSearchParams({ from: `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`, to: `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`, at: when, type });
  const j = await api<{ routes: TransitRoute[] }>(`/api/transit?${q}`, { signal, timeout: 25000 });
  return j.routes || [];
}

/** Walking or driving route on Google (Routes library), or a straight-line estimate. */
export async function simpleRoute(from: LatLng, to: LatLng, mode: 'walk' | 'drive'): Promise<SimpleRoute> {
  const straight = distance(from, to);
  const estimate: SimpleRoute = {
    minutes: mode === 'walk' ? walkMinutes(straight) : Math.max(3, Math.round((straight * 1.35) / 1000 / 25 * 60) + 3),
    meters: Math.round(straight * (mode === 'walk' ? 1.25 : 1.35)),
    path: [from, to],
    source: 'estimate',
  };
  if (!googleActive()) return estimate;
  if (!(await loadRoutesLibrary())) return estimate;
  try {
    const R = (google.maps as unknown as { routes?: { Route?: { computeRoutes: (r: unknown) => Promise<{ routes?: unknown[] }> } } }).routes?.Route;
    if (!R) return estimate;
    const req = (fields: string[]) => R.computeRoutes({
      origin: from, destination: to, travelMode: mode === 'walk' ? 'WALKING' : 'DRIVING', fields, language: 'ko', region: 'jp',
    });
    let res: { routes?: unknown[] };
    try { res = await req(['durationMillis', 'distanceMeters', 'path', 'legs']); } catch { res = await req(['*']); }
    const r = res.routes?.[0] as { durationMillis?: number; distanceMeters?: number; path?: { lat: number | (() => number); lng: number | (() => number) }[]; legs?: { steps?: { instructions?: string; navigationInstruction?: { instructions?: string } }[] }[] } | undefined;
    if (!r) return estimate;
    const path = (r.path || []).map(p => ({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }));
    const steps = (r.legs || []).flatMap(l => (l.steps || []).map(s => s.navigationInstruction?.instructions || s.instructions || '')).filter(Boolean).slice(0, 25);
    return {
      minutes: r.durationMillis ? Math.max(1, Math.round(r.durationMillis / 60000)) : estimate.minutes,
      meters: r.distanceMeters ?? estimate.meters,
      path: path.length > 1 ? path : [from, to],
      source: 'google',
      steps,
    };
  } catch {
    return estimate;
  }
}
