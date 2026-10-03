'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { distance, inJapan } from '@/lib/geo';
import { category } from '@/lib/categories';
import { openPlace } from '@/lib/actions';
import { createGoogleMap } from '@/lib/map/google';
import { loadGoogleMaps, onGoogleAuthFailure } from '@/lib/map/googleLoader';
import { mapApi } from '@/lib/map/instance';
import { createMapLibre } from '@/lib/map/maplibre';
import type { MapAdapter, MarkerSpec } from '@/lib/map/types';
import { activePlaces } from '@/lib/places';
import { useGeo, geo } from '@/lib/store/geo';
import { usePlaces, places } from '@/lib/store/places';
import { runtime, useRuntime } from '@/lib/store/runtime';
import { useSettings, settings } from '@/lib/store/settings';
import { toast, ui, useUi } from '@/lib/store/ui';
import { useTrip } from '@/lib/store/trip';
import { sheetHeights } from './Sheet';

const DEFAULT_VIEW = { lat: 35.6812, lng: 139.7671, zoom: 13 };
/** Set once the user pans the map by hand (then we stop auto-centring). */
let userMoved = false;

function savedView() {
  try {
    const v = JSON.parse(localStorage.getItem('gilnun.view') || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom)) return v as typeof DEFAULT_VIEW;
  } catch { /* ignore */ }
  return DEFAULT_VIEW;
}

function prefersDark(theme: string) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function buildMarkers(): MarkerSpec[] {
  const s = places();
  const specs: MarkerSpec[] = [];
  // While a trip day is on the map, its numbered stops replace search/AI pins so the numbers don't clash.
  const tripMode = s.extraPins.some(e => e.kind === 'stop');
  for (const id of tripMode ? [] : s.markers) {
    const p = s.byId[id];
    if (!p || (s.dest && s.dest.id === id)) continue;
    const C = category(p.category);
    const sel = s.selected === id;
    specs.push({ id, lat: p.lat, lng: p.lng, kind: 'place', color: C.color, label: (s.refOf[id] || '').slice(1), title: p.name, caption: sel ? p.name : undefined, selected: sel });
  }
  if (s.dest) specs.push({ id: s.dest.id, lat: s.dest.lat, lng: s.dest.lng, kind: 'dest', color: '#FFD21F', title: `목적지: ${s.dest.name}`, caption: s.dest.name, z: 500, selected: s.selected === s.dest.id });
  for (const e of s.extraPins) specs.push({ id: `x:${e.kind}:${e.id}`, lat: e.lat, lng: e.lng, kind: e.kind, color: e.color, label: e.label, icon: e.icon, title: e.label, caption: undefined, z: 300 });
  return specs;
}

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const config = useRuntime(s => s.config);
  const googleKey = useSettings(s => s.googleKey);
  const forceFree = useSettings(s => s.forceFreeMap);
  const theme = useSettings(s => s.theme);
  const mapLang = useSettings(s => s.mapLang);
  const engine = useRuntime(s => s.engine);
  const sheet = useUi(s => s.sheet);
  const tab = useUi(s => s.tab);

  // Create the map (Google when a key exists and loads; otherwise the free OSM map).
  useEffect(() => {
    if (!config || !el.current) return;
    const container = el.current;
    let cancelled = false;
    let adapter: MapAdapter | null = null;
    const view = savedView();
    const center = { lat: view.lat, lng: view.lng };

    const wire = (a: MapAdapter) => {
      a.onMarkerClick(id => {
        if (id.startsWith('x:')) {
          const [, kind, rid] = id.split(':');
          if (kind === 'res') { ui().setTab('booking', 'half'); ui().push({ type: 'reservation', id: rid }); }
          else { const t = useTrip.getState().activeTripId; if (t) { ui().setTab('trip', 'half'); } }
          return;
        }
        openPlace(id, { fly: false });
      });
      a.onGesture(() => { userMoved = true; if (geo().follow) geo().setFollow(false); });
      a.onMapClick(() => {
        const u = ui();
        if (u.layersOpen) u.setLayers(false);
        if (u.sheet === 'full' && window.innerWidth < 768) u.setSheet('half');
      });
      a.onPoiClick(async (placeId, at) => {
        const id = `g:${placeId}`;
        if (places().byId[id]) { openPlace(id, { fly: false }); return; }
        try {
          const d = await activePlaces().details({ id, source: 'google', placeId, name: '', lat: at.lat, lng: at.lng, category: 'place' });
          places().register(d);
          openPlace(id, { fly: false });
        } catch { toast('장소 정보를 불러오지 못했어요'); }
      });
      let saveT: ReturnType<typeof setTimeout> | undefined;
      a.onCamera(() => {
        clearTimeout(saveT);
        saveT = setTimeout(() => {
          const c = a.getCenter();
          try { localStorage.setItem('gilnun.view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: a.getZoom() })); } catch { /* ignore */ }
        }, 800);
      });
    };

    const startFree = async (reason?: string) => {
      let a: MapAdapter;
      try {
        a = await createMapLibre(container, { center, zoom: view.zoom, dark: prefersDark(settings().theme), lang: settings().mapLang });
      } catch (e) {
        // No WebGL (very old phone, GPU blocklisted): keep every panel working without a map.
        console.warn('free map failed', e);
        runtime().set({ engine: null, mapReady: false, googleError: runtime().googleError || 'webgl' });
        if (!cancelled) toast('이 기기에서는 지도를 그릴 수 없어요. 검색·일정·AI는 그대로 쓸 수 있어요.');
        return;
      }
      if (cancelled) { a.destroy(); return; }
      adapter = a;
      runtime().set({ engine: 'maplibre', mapReady: true });
      wire(a);
      mapApi.set(a);
      if (reason) toast(reason);
    };

    (async () => {
      const key = (settings().googleKey || config.google.mapsKey || '').trim();
      if (key && !settings().forceFreeMap) {
        runtime().set({ googleState: 'loading', googleError: null });
        try {
          await loadGoogleMaps(key, settings().mapLang, config.google.mapId);
          if (cancelled) return;
          const a = createGoogleMap(container, { center, zoom: view.zoom, mapId: config.google.mapId, scheme: settings().theme });
          adapter = a;
          runtime().set({ engine: 'google', googleState: 'ready', mapReady: true });
          wire(a);
          mapApi.set(a);
          return;
        } catch (e) {
          const msg = String((e as Error)?.message || e);
          if (msg === 'reload_required') { location.reload(); return; }
          runtime().set({ googleState: 'error', googleError: msg });
          if (cancelled) return;
          await startFree(msg === 'auth_failed' ? '구글 지도 키가 맞지 않아 무료 지도로 열었어요 (설정 → 진단)' : '구글 지도를 불러오지 못해 무료 지도로 열었어요');
          return;
        }
      }
      runtime().set({ googleState: 'off' });
      await startFree();
    })();

    const offAuth = onGoogleAuthFailure(() => {
      if (cancelled || runtime().engine !== 'google') return;
      runtime().set({ googleState: 'error', googleError: 'auth_failed', mapReady: false });
      adapter?.destroy();
      adapter = null;
      mapApi.set(null);
      void startFree('구글 지도 키가 맞지 않아 무료 지도로 바꿨어요 (설정 → 진단)');
    });

    return () => {
      cancelled = true;
      offAuth();
      adapter?.destroy();
      mapApi.set(null);
      runtime().set({ mapReady: false });
    };
  }, [config, googleKey, forceFree, theme, mapLang]);

  // Markers, user dot, routes, layers.
  useEffect(() => {
    if (!engine) return;
    let alive = true;
    void mapApi.ready().then(a => {
      if (!alive) return;
      a.setMarkers(buildMarkers());
      const g = geo();
      a.setUser(g.me ? { ...g.me, heading: g.heading, stale: Date.now() - g.me.t > 120000 } : null);
      a.setRoutes(places().routes);
      a.setLayer('transit', settings().transitLayer);
      a.setLayer('traffic', settings().trafficLayer);
    });
    const unP = usePlaces.subscribe((s, prev) => {
      const a = mapApi.get();
      if (!a) return;
      if (s.markers !== prev.markers || s.selected !== prev.selected || s.dest !== prev.dest || s.byId !== prev.byId || s.extraPins !== prev.extraPins || s.refOf !== prev.refOf) a.setMarkers(buildMarkers());
      if (s.routes !== prev.routes) a.setRoutes(s.routes);
    });
    let lastFollow = 0;
    // First fix in Japan: show where the user is unless they already moved the map themselves.
    let centred = false;
    const centreOnce = () => {
      const g = geo();
      const a = mapApi.get();
      if (centred || !a || !g.me || !inJapan(g.me) || userMoved) return;
      centred = true;
      if (distance(g.me, a.getCenter()) > 400) a.focus({ lat: g.me.lat, lng: g.me.lng }, Math.max(a.getZoom(), 15.5), false);
    };
    void mapApi.ready().then(() => { if (alive) centreOnce(); });
    const unG = useGeo.subscribe((s, prev) => {
      const a = mapApi.get();
      if (!a) return;
      if (s.me && !prev.me) centreOnce();
      if (s.me !== prev.me || s.heading !== prev.heading) a.setUser(s.me ? { ...s.me, heading: s.heading, stale: false } : null);
      if (s.follow && s.me && (s.me !== prev.me || s.follow !== prev.follow) && Date.now() - lastFollow > 700) {
        lastFollow = Date.now();
        a.focus({ lat: s.me.lat, lng: s.me.lng }, s.follow !== prev.follow ? Math.max(a.getZoom(), 16) : undefined);
      }
    });
    const unS = useSettings.subscribe((s, prev) => {
      const a = mapApi.get();
      if (!a) return;
      if (s.transitLayer !== prev.transitLayer) a.setLayer('transit', s.transitLayer);
      if (s.trafficLayer !== prev.trafficLayer) a.setLayer('traffic', s.trafficLayer);
    });
    return () => { alive = false; unP(); unG(); unS(); };
  }, [engine]);

  // Keep the map's visible area in sync with the sheet / top bar.
  useEffect(() => {
    const update = () => {
      const a = mapApi.get();
      if (!a) return;
      const wide = window.innerWidth >= 768;
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect();
      const sheetEl = document.querySelector('.sheet')?.getBoundingClientRect();
      if (wide) {
        a.setInsets({ top: 12, bottom: 12, left: Math.round((sheetEl?.right ?? 0) + 8), right: 70 });
      } else {
        // Use the snap the sheet is heading to, so a fit right after opening a list lands above it.
        const bottom = Math.round((tabbar?.height ?? 0) + sheetHeights()[ui().sheet]);
        a.setInsets({ top: Math.round(top) + 4, bottom: Math.max(0, Math.min(window.innerHeight - 80, bottom)), left: 0, right: 64 });
      }
    };
    const id = setTimeout(update, 340); // after the sheet transition
    update();
    window.addEventListener('resize', update);
    return () => { clearTimeout(id); window.removeEventListener('resize', update); };
  }, [sheet, tab, engine]);

  return <div ref={el} className="map" aria-label="지도" role="application" />;
}
