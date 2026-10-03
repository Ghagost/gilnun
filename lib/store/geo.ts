import { create } from 'zustand';

export type Me = { lat: number; lng: number; acc: number; t: number };
export type Area = { label: string; city: string; cc: string; at: { lat: number; lng: number }; t: number };

type GeoState = {
  me: Me | null;
  heading: number | null;
  error: 'denied' | 'unavailable' | 'unsupported' | 'insecure' | null;
  follow: boolean;
  area: Area | null;
  compassAsked: boolean;
  setMe: (me: Me) => void;
  setHeading: (h: number | null) => void;
  setError: (e: GeoState['error']) => void;
  setFollow: (f: boolean) => void;
  setArea: (a: Area) => void;
  setCompassAsked: (v: boolean) => void;
};

export const useGeo = create<GeoState>()(set => ({
  me: null,
  heading: null,
  error: null,
  follow: false,
  area: null,
  compassAsked: false,
  setMe: me => set({ me, error: null }),
  setHeading: heading => set({ heading }),
  setError: error => set({ error }),
  setFollow: follow => set({ follow }),
  setArea: area => set({ area }),
  setCompassAsked: compassAsked => set({ compassAsked }),
}));

export const geo = () => useGeo.getState();
