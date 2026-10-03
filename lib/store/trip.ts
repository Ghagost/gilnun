import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Reservation, SavedEntry, SavedList, SavedPlace, Trip, TripDay, TripStop } from '../types';
import { addDays, daysBetween, uid } from '../format';
import { idbJSON, delBlob } from './idb';
import { distance } from '../geo';

export const DEFAULT_LISTS: SavedList[] = [
  { id: 'want', name: '가고 싶은 곳', emoji: '⭐' },
  { id: 'food', name: '맛집', emoji: '🍜' },
  { id: 'stay', name: '숙소', emoji: '🏨' },
];

export function daysFor(start: string, end: string, prev: TripDay[] = []): TripDay[] {
  const n = Math.max(0, Math.min(60, daysBetween(start, end)));
  const out: TripDay[] = [];
  for (let i = 0; i <= n; i++) {
    const date = addDays(start, i);
    out.push(prev.find(d => d.date === date) || { date, stops: [] });
  }
  return out;
}

/** Nearest-neighbour ordering that keeps the first stop and any stops with fixed times in place. */
export function optimizeStops(stops: TripStop[]): TripStop[] {
  if (stops.length < 3) return stops;
  const fixed = stops.filter(s => s.time);
  if (fixed.length) {
    // Keep timed stops anchored: sort by time, place untimed ones greedily between them.
    const timed = [...fixed].sort((a, b) => (a.time! < b.time! ? -1 : 1));
    const free = stops.filter(s => !s.time);
    const out: TripStop[] = [];
    let cur = timed[0];
    out.push(cur);
    const remainingTimed = timed.slice(1);
    const pool = [...free];
    while (pool.length || remainingTimed.length) {
      const nextTimed = remainingTimed[0];
      if (!pool.length) { out.push(...remainingTimed); break; }
      let bi = 0, bd = Infinity;
      pool.forEach((s, i) => { const d = distance(cur.place, s.place); if (d < bd) { bd = d; bi = i; } });
      if (nextTimed && distance(cur.place, nextTimed.place) < bd) { out.push(nextTimed); cur = nextTimed; remainingTimed.shift(); continue; }
      cur = pool.splice(bi, 1)[0];
      out.push(cur);
    }
    return out;
  }
  const [first, ...rest] = stops;
  const out = [first];
  let cur = first;
  const pool = [...rest];
  while (pool.length) {
    let bi = 0, bd = Infinity;
    pool.forEach((s, i) => { const d = distance(cur.place, s.place); if (d < bd) { bd = d; bi = i; } });
    cur = pool.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

type TripState = {
  trips: Trip[];
  activeTripId: string | null;
  saved: Record<string, SavedEntry>;
  lists: SavedList[];
  reservations: Reservation[];
  hydrated: boolean;
  createTrip: (t: { title: string; city?: string; start: string; end: string }) => string;
  updateTrip: (id: string, patch: Partial<Pick<Trip, 'title' | 'city' | 'start' | 'end'>>) => void;
  deleteTrip: (id: string) => void;
  importTrip: (t: Trip) => string;
  setActiveTrip: (id: string | null) => void;
  addStop: (tripId: string, date: string, place: SavedPlace, extra?: Partial<TripStop>) => string | null;
  updateStop: (tripId: string, date: string, stopId: string, patch: Partial<TripStop>) => void;
  removeStop: (tripId: string, date: string, stopId: string) => void;
  moveStop: (tripId: string, date: string, stopId: string, dir: -1 | 1) => void;
  moveStopToDay: (tripId: string, from: string, stopId: string, to: string) => void;
  setDayStops: (tripId: string, date: string, stops: TripStop[]) => void;
  toggleSaved: (p: SavedPlace, list?: string) => boolean;
  setSavedLists: (id: string, lists: string[]) => void;
  setSavedNote: (id: string, note: string) => void;
  addList: (name: string, emoji?: string) => string;
  upsertReservation: (r: Omit<Reservation, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<Reservation, 'id' | 'status'>>) => string;
  deleteReservation: (id: string) => void;
};

const touch = (t: Trip): Trip => ({ ...t, updatedAt: Date.now() });

export const useTrip = create<TripState>()(
  persist(
    (set, get) => {
      const mapTrip = (id: string, fn: (t: Trip) => Trip) => set(s => ({ trips: s.trips.map(t => (t.id === id ? touch(fn(t)) : t)) }));
      const mapDay = (tripId: string, date: string, fn: (d: TripDay) => TripDay) =>
        mapTrip(tripId, t => ({ ...t, days: t.days.map(d => (d.date === date ? fn(d) : d)) }));
      return {
        trips: [],
        activeTripId: null,
        saved: {},
        lists: DEFAULT_LISTS,
        reservations: [],
        hydrated: false,
        createTrip: ({ title, city, start, end }) => {
          const id = uid('t');
          const s = start <= end ? start : end, e = start <= end ? end : start;
          const trip: Trip = { id, title: title.trim() || '새 여행', city: city?.trim() || undefined, start: s, end: e, days: daysFor(s, e), createdAt: Date.now(), updatedAt: Date.now() };
          set(st => ({ trips: [trip, ...st.trips], activeTripId: id }));
          return id;
        },
        updateTrip: (id, patch) => mapTrip(id, t => {
          const start = patch.start ?? t.start, end = patch.end ?? t.end;
          const s = start <= end ? start : end, e = start <= end ? end : start;
          // Stops on days that fall outside the new range move to the nearest remaining day.
          const days = daysFor(s, e, t.days);
          const orphans = t.days.filter(d => d.date < s || d.date > e).flatMap(d => d.stops);
          if (orphans.length && days.length) {
            const last = days[days.length - 1];
            days[days.length - 1] = { ...last, stops: [...last.stops, ...orphans] };
          }
          return { ...t, ...patch, start: s, end: e, days };
        }),
        deleteTrip: id => set(s => ({ trips: s.trips.filter(t => t.id !== id), activeTripId: s.activeTripId === id ? null : s.activeTripId })),
        importTrip: t => {
          const id = uid('t');
          const days = daysFor(t.start, t.end, (t.days || []).map(d => ({ ...d, stops: (d.stops || []).map(st => ({ ...st, id: uid('s') })) })));
          const trip: Trip = { ...t, id, days, createdAt: Date.now(), updatedAt: Date.now() };
          set(s => ({ trips: [trip, ...s.trips], activeTripId: id }));
          return id;
        },
        setActiveTrip: activeTripId => set({ activeTripId }),
        addStop: (tripId, date, place, extra) => {
          const trip = get().trips.find(t => t.id === tripId);
          if (!trip) return null;
          const id = uid('s');
          const day = trip.days.find(d => d.date === date) ? date : trip.days[0]?.date;
          if (!day) return null;
          mapDay(tripId, day, d => ({ ...d, stops: [...d.stops, { id, place, ...extra }] }));
          return id;
        },
        updateStop: (tripId, date, stopId, patch) => mapDay(tripId, date, d => ({ ...d, stops: d.stops.map(s => (s.id === stopId ? { ...s, ...patch } : s)) })),
        removeStop: (tripId, date, stopId) => mapDay(tripId, date, d => ({ ...d, stops: d.stops.filter(s => s.id !== stopId) })),
        moveStop: (tripId, date, stopId, dir) => mapDay(tripId, date, d => {
          const i = d.stops.findIndex(s => s.id === stopId);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= d.stops.length) return d;
          const stops = [...d.stops];
          [stops[i], stops[j]] = [stops[j], stops[i]];
          return { ...d, stops };
        }),
        moveStopToDay: (tripId, from, stopId, to) => mapTrip(tripId, t => {
          const src = t.days.find(d => d.date === from);
          const stop = src?.stops.find(s => s.id === stopId);
          if (!stop || from === to) return t;
          return { ...t, days: t.days.map(d => (d.date === from ? { ...d, stops: d.stops.filter(s => s.id !== stopId) } : d.date === to ? { ...d, stops: [...d.stops, stop] } : d)) };
        }),
        setDayStops: (tripId, date, stops) => mapDay(tripId, date, d => ({ ...d, stops })),
        toggleSaved: (p, list = 'want') => {
          const s = get();
          if (s.saved[p.id]) {
            const { [p.id]: _, ...rest } = s.saved;
            set({ saved: rest });
            return false;
          }
          set({ saved: { ...s.saved, [p.id]: { ...p, lists: [list], savedAt: Date.now() } } });
          return true;
        },
        setSavedLists: (id, lists) => set(s => (s.saved[id] ? { saved: { ...s.saved, [id]: { ...s.saved[id], lists } } } : {})),
        setSavedNote: (id, note) => set(s => (s.saved[id] ? { saved: { ...s.saved, [id]: { ...s.saved[id], note } } } : {})),
        addList: (name, emoji = '📍') => {
          const id = uid('l');
          set(s => ({ lists: [...s.lists, { id, name: name.trim() || '새 목록', emoji }] }));
          return id;
        },
        upsertReservation: r => {
          const now = Date.now();
          const id = r.id || uid('r');
          set(s => {
            const existing = s.reservations.find(x => x.id === id);
            const next: Reservation = existing
              ? { ...existing, ...r, id, updatedAt: now }
              : { ...r, id, status: r.status || 'booked', createdAt: now, updatedAt: now } as Reservation;
            return { reservations: existing ? s.reservations.map(x => (x.id === id ? next : x)) : [...s.reservations, next] };
          });
          return id;
        },
        deleteReservation: id => {
          const r = get().reservations.find(x => x.id === id);
          r?.photoIds?.forEach(p => void delBlob(p));
          set(s => ({ reservations: s.reservations.filter(x => x.id !== id) }));
        },
      };
    },
    {
      name: 'gilnun.trip',
      version: 1,
      storage: idbJSON,
      partialize: s => ({ trips: s.trips, activeTripId: s.activeTripId, saved: s.saved, lists: s.lists, reservations: s.reservations }) as unknown as TripState,
      onRehydrateStorage: () => () => { useTrip.setState({ hydrated: true }); },
    },
  ),
);

export const tripStore = () => useTrip.getState();
