import { create } from 'zustand';
import type { SavedPlace } from '../types';

export type Tab = 'map' | 'trip' | 'ai' | 'booking' | 'tools';
export type Snap = 'peek' | 'half' | 'full';

export type Panel =
  | { type: 'home' }
  | { type: 'results' }
  | { type: 'place'; id: string }
  | { type: 'directions'; to: SavedPlace; mode?: 'transit' | 'walk' | 'drive' | 'taxi' }
  | { type: 'saved' }
  | { type: 'trips' }
  | { type: 'trip'; id: string; day?: string }
  | { type: 'chat' }
  | { type: 'reservations' }
  | { type: 'reservation'; id: string }
  | { type: 'tools' }
  | { type: 'phrases' }
  | { type: 'interpreter' }
  | { type: 'currency' }
  | { type: 'weather' }
  | { type: 'safety' }
  | { type: 'settings'; section?: string }
  | { type: 'diagnostics' }
  | { type: 'about' };

export type PickTarget = { kind: 'trip'; tripId: string; date: string } | { kind: 'reservation' } | { kind: 'directionsFrom' };

export type Overlay =
  | { type: 'search'; pick?: PickTarget; initial?: string; voice?: boolean }
  | { type: 'camera' }
  | { type: 'live' }
  | { type: 'bigtext'; ja: string; ko?: string; addr?: string; lead?: string }
  | { type: 'booking'; placeId: string }
  | { type: 'resForm'; id?: string; prefill?: Record<string, unknown> }
  | { type: 'tripForm'; id?: string }
  | { type: 'stopEdit'; tripId: string; date: string; stopId: string }
  | { type: 'onboarding' }
  | { type: 'photo'; src: string; caption?: string }
  | { type: 'import'; token: string };

const ROOT: Record<Tab, Panel> = {
  map: { type: 'home' }, trip: { type: 'trips' }, ai: { type: 'chat' }, booking: { type: 'reservations' }, tools: { type: 'tools' },
};
const DEFAULT_SNAP: Record<Tab, Snap> = { map: 'peek', trip: 'half', ai: 'full', booking: 'full', tools: 'full' };

type UiState = {
  tab: Tab;
  stacks: Record<Tab, Panel[]>;
  sheet: Snap;
  overlays: Overlay[];
  toast: { msg: string; id: number } | null;
  layersOpen: boolean;
  /** Pending chat prompt sent from elsewhere (place sheet, home…). */
  chatDraft: { text: string; send: boolean; image?: { mime: string; b64: string } | null; id: number } | null;
  setTab: (t: Tab, snap?: Snap) => void;
  push: (p: Panel, snap?: Snap) => void;
  pop: () => boolean;
  resetTab: (t?: Tab) => void;
  setSheet: (s: Snap) => void;
  open: (o: Overlay) => void;
  close: (type?: Overlay['type']) => void;
  showToast: (msg: string) => void;
  setLayers: (v: boolean) => void;
  ask: (text: string, opts?: { send?: boolean; image?: { mime: string; b64: string } | null }) => void;
  clearDraft: () => void;
};

export const useUi = create<UiState>()((set, get) => ({
  tab: 'map',
  stacks: { map: [ROOT.map], trip: [ROOT.trip], ai: [ROOT.ai], booking: [ROOT.booking], tools: [ROOT.tools] },
  sheet: 'peek',
  overlays: [],
  toast: null,
  layersOpen: false,
  chatDraft: null,
  setTab: (t, snap) => {
    const s = get();
    if (s.tab === t) {
      // Re-tapping the active tab returns to its root.
      if (s.stacks[t].length > 1) set({ stacks: { ...s.stacks, [t]: [ROOT[t]] } });
      if (snap) set({ sheet: snap });
      return;
    }
    set({ tab: t, sheet: snap ?? (t === 'map' && s.stacks.map.length > 1 ? 'half' : DEFAULT_SNAP[t]), layersOpen: false });
  },
  push: (p, snap) => set(s => {
    const stack = s.stacks[s.tab];
    const top = stack[stack.length - 1];
    // Replace instead of stacking the same kind of panel twice (e.g. place → place).
    const same = top && top.type === p.type && (p.type === 'place' || p.type === 'results' || p.type === 'directions');
    const next = same ? [...stack.slice(0, -1), p] : [...stack, p];
    return { stacks: { ...s.stacks, [s.tab]: next.slice(-12) }, sheet: snap ?? (s.sheet === 'peek' ? 'half' : s.sheet) };
  }),
  pop: () => {
    const s = get();
    const stack = s.stacks[s.tab];
    if (stack.length <= 1) return false;
    const next = stack.slice(0, -1);
    set({ stacks: { ...s.stacks, [s.tab]: next }, sheet: next.length === 1 ? DEFAULT_SNAP[s.tab] : s.sheet });
    return true;
  },
  resetTab: t => set(s => {
    const tab = t ?? s.tab;
    return { stacks: { ...s.stacks, [tab]: [ROOT[tab]] } };
  }),
  setSheet: sheet => set({ sheet }),
  open: o => set(s => ({ overlays: [...s.overlays.filter(x => x.type !== o.type), o], layersOpen: false })),
  close: type => set(s => {
    if (!s.overlays.length) return {};
    if (!type) return { overlays: s.overlays.slice(0, -1) };
    return { overlays: s.overlays.filter(x => x.type !== type) };
  }),
  showToast: msg => set({ toast: { msg, id: Date.now() } }),
  setLayers: layersOpen => set({ layersOpen }),
  ask: (text, opts) => {
    set({ chatDraft: { text, send: opts?.send ?? true, image: opts?.image ?? null, id: Date.now() } });
    get().setTab('ai', 'full');
  },
  clearDraft: () => set({ chatDraft: null }),
}));

export const ui = () => useUi.getState();
export const toast = (msg: string) => useUi.getState().showToast(msg);

export function currentPanel(s: UiState = useUi.getState()): Panel {
  const st = s.stacks[s.tab];
  return st[st.length - 1];
}
