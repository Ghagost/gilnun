import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaceSummary, RouteLine, SavedPlace } from '../types';
import { localJSON } from './idb';

export type ResultsState = {
  key: number;
  title: string;
  meta?: string;
  ids: string[];
  loading?: boolean;
  error?: string;
  gLink?: string;
  query?: string;
  cat?: string;
  center?: { lat: number; lng: number };
  kind?: string;
};

type PlacesState = {
  byId: Record<string, PlaceSummary>;
  refOf: Record<string, string>;
  idOf: Record<string, string>;
  nextRef: number;
  markers: string[];
  selected: string | null;
  results: ResultsState | null;
  dest: SavedPlace | null;
  routes: RouteLine[];
  /** Itinerary/reservation pins drawn on the map (ids → label). */
  extraPins: { id: string; lat: number; lng: number; label: string; color: string; icon?: string; kind: 'stop' | 'res' }[];
  register: (p: PlaceSummary) => string;
  registerMany: (ps: PlaceSummary[]) => string[];
  update: (id: string, patch: Partial<PlaceSummary>) => void;
  setMarkers: (ids: string[]) => void;
  addMarkers: (ids: string[]) => void;
  select: (id: string | null) => void;
  setResults: (r: ResultsState | null) => void;
  setDest: (p: SavedPlace | null) => void;
  setRoutes: (r: RouteLine[]) => void;
  setExtraPins: (p: PlacesState['extraPins']) => void;
};

export const usePlaces = create<PlacesState>()(
  persist(
    (set, get) => ({
      byId: {},
      refOf: {},
      idOf: {},
      nextRef: 1,
      markers: [],
      selected: null,
      results: null,
      dest: null,
      routes: [],
      extraPins: [],
      register: p => {
        const s = get();
        const existing = s.refOf[p.id];
        const merged = s.byId[p.id] ? { ...s.byId[p.id], ...stripUndef(p) } : p;
        if (existing) { set({ byId: { ...s.byId, [p.id]: merged } }); return existing; }
        const ref = `P${s.nextRef}`;
        set({ byId: { ...s.byId, [p.id]: merged }, refOf: { ...s.refOf, [p.id]: ref }, idOf: { ...s.idOf, [ref]: p.id }, nextRef: s.nextRef + 1 });
        return ref;
      },
      registerMany: ps => ps.map(p => get().register(p)),
      update: (id, patch) => set(s => (s.byId[id] ? { byId: { ...s.byId, [id]: { ...s.byId[id], ...stripUndef(patch) } } } : {})),
      setMarkers: ids => set({ markers: [...new Set(ids)] }),
      addMarkers: ids => set(s => ({ markers: [...new Set([...s.markers, ...ids])] })),
      select: selected => set({ selected }),
      setResults: results => set({ results }),
      setDest: dest => set({ dest }),
      setRoutes: routes => set({ routes }),
      setExtraPins: extraPins => set({ extraPins }),
    }),
    {
      name: 'gilnun.dest',
      version: 1,
      storage: localJSON,
      partialize: s => ({ dest: s.dest }) as unknown as PlacesState,
    },
  ),
);

function stripUndef<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export const places = () => usePlaces.getState();

/** Resolves "P3", "3" or an id to a registered place. */
export function placeByRef(refOrId: string | null | undefined): PlaceSummary | null {
  if (!refOrId) return null;
  const s = usePlaces.getState();
  const k = String(refOrId).trim().toUpperCase();
  const ref = /^\d+$/.test(k) ? `P${k}` : k;
  const id = s.idOf[ref] || refOrId;
  return s.byId[id] || null;
}

export function toSaved(p: PlaceSummary): SavedPlace {
  return { id: p.id, placeId: p.placeId, name: p.name, nameLocal: p.nameLocal, lat: p.lat, lng: p.lng, category: p.category, address: p.address };
}
