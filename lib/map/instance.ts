import type { LatLng } from '../geo';
import type { MapAdapter } from './types';

let current: MapAdapter | null = null;
const waiters: ((m: MapAdapter) => void)[] = [];

export const mapApi = {
  get: () => current,
  set(a: MapAdapter | null) {
    current = a;
    if (a) waiters.splice(0).forEach(fn => fn(a));
  },
  ready(): Promise<MapAdapter> {
    return current ? Promise.resolve(current) : new Promise(r => waiters.push(r));
  },
  focus(p: LatLng, zoom?: number) { current?.focus(p, zoom); },
  fit(points: LatLng[], maxZoom?: number) { current?.fitPoints(points, maxZoom); },
  center(): LatLng | null { return current?.getCenter() ?? null; },
};
