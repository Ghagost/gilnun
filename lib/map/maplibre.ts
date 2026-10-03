import type { LatLng } from '../geo';
import { circleRing } from '../geo';
import type { RouteLine } from '../types';
import { markerKey, renderMarker, renderUser } from './markers';
import type { Insets, MapAdapter, MarkerSpec, UserSpec } from './types';

type ML = typeof import('maplibre-gl');

const STYLES = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
const CJK_FONT = '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

function labelExpr(lang: 'ko' | 'ja'): unknown {
  const ja = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
  if (lang === 'ja') return ja;
  return ['case', ['all', ['has', 'name:ko'], ['!=', ['get', 'name:ko'], ['get', 'name']]],
    ['format', ['get', 'name:ko'], {}, '\n', {}, ja, { 'font-scale': 0.8 }], ja];
}

export async function createMapLibre(el: HTMLElement, opts: { center: LatLng; zoom: number; dark: boolean; lang: 'ko' | 'ja'; interactive?: boolean }): Promise<MapAdapter> {
  const mod = (await import('maplibre-gl')) as unknown as ML & { default?: ML };
  const ml: ML = (mod.default ?? mod) as ML;
  const map = new ml.Map({
    container: el,
    style: opts.dark ? STYLES.dark : STYLES.light,
    center: [opts.center.lng, opts.center.lat],
    zoom: opts.zoom,
    attributionControl: false,
    maxPitch: 70,
    localIdeographFontFamily: CJK_FONT,
    interactive: opts.interactive !== false,
  });
  map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-left');

  const markers = new Map<string, { m: InstanceType<ML['Marker']>; el: HTMLElement; key: string; lat: number; lng: number }>();
  let markerCb: (id: string) => void = () => {};
  let gestureCb: () => void = () => {};
  let clickCb: (at: LatLng) => void = () => {};
  let cameraCb: () => void = () => {};
  let userMarker: { m: InstanceType<ML['Marker']>; el: HTMLElement } | null = null;
  let userData: UserSpec = null;
  let routeData: RouteLine[] = [];

  function applyLabels() {
    const st = map.getStyle();
    if (!st?.layers) return;
    for (const l of st.layers) {
      if (l.type !== 'symbol') continue;
      const tf = (l.layout as Record<string, unknown> | undefined)?.['text-field'];
      if (!tf || !/name/.test(JSON.stringify(tf))) continue;
      try { map.setLayoutProperty(l.id, 'text-field', labelExpr(opts.lang) as never); } catch { /* keep style default */ }
    }
  }
  function ensureOverlay() {
    try {
      if (!map.getSource('acc')) map.addSource('acc', { type: 'geojson', data: EMPTY });
      if (!map.getLayer('acc-fill')) map.addLayer({ id: 'acc-fill', type: 'fill', source: 'acc', paint: { 'fill-color': '#2F6BFF', 'fill-opacity': 0.12 } });
      if (!map.getSource('routes')) map.addSource('routes', { type: 'geojson', data: EMPTY });
      if (!map.getLayer('routes-solid')) map.addLayer({ id: 'routes-solid', type: 'line', source: 'routes', filter: ['!=', ['get', 'dashed'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.9 } });
      if (!map.getLayer('routes-dash')) map.addLayer({ id: 'routes-dash', type: 'line', source: 'routes', filter: ['==', ['get', 'dashed'], true], layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1.2, 1.6] } });
    } catch { /* style not ready */ }
    drawOverlay();
  }
  function drawOverlay() {
    const acc = map.getSource('acc') as { setData?: (d: unknown) => void } | undefined;
    acc?.setData?.(userData && userData.acc ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(userData, Math.min(userData.acc, 2000))] } }] } : EMPTY);
    const rs = map.getSource('routes') as { setData?: (d: unknown) => void } | undefined;
    rs?.setData?.({ type: 'FeatureCollection', features: routeData.filter(r => r.points.length > 1).map(r => ({ type: 'Feature', properties: { color: r.color, width: r.width ?? 6, dashed: !!r.dashed }, geometry: { type: 'LineString', coordinates: r.points.map(p => [p.lng, p.lat]) } })) });
  }

  map.on('style.load', () => { applyLabels(); ensureOverlay(); });
  map.on('dragstart', () => gestureCb());
  map.on('click', e => clickCb({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
  map.on('moveend', () => cameraCb());

  await new Promise<void>(resolve => {
    if (map.loaded()) resolve();
    else { map.once('load', () => resolve()); map.once('error', () => resolve()); setTimeout(resolve, 8000); }
  });

  const adapter: MapAdapter = {
    engine: 'maplibre',
    getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
    getZoom: () => map.getZoom(),
    getHeading: () => map.getBearing(),
    isTilted: () => map.getPitch() > 5,
    setInsets: (i: Insets) => {
      const cur = map.getPadding();
      if (cur.top === i.top && cur.bottom === i.bottom && cur.left === i.left && cur.right === i.right) return;
      map.setPadding(i);
    },
    focus: (p, zoom, animate = true) => {
      const z = zoom ?? Math.max(map.getZoom(), 15);
      if (animate) map.easeTo({ center: [p.lng, p.lat], zoom: z, duration: 550 });
      else map.jumpTo({ center: [p.lng, p.lat], zoom: z });
    },
    fitPoints: (points, maxZoom = 17) => {
      const pts = points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (!pts.length) return;
      if (pts.length === 1) { adapter.focus(pts[0], Math.max(map.getZoom(), 16)); return; }
      const b = new ml.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]);
      pts.forEach(p => b.extend([p.lng, p.lat]));
      map.fitBounds(b, { padding: { top: 36, bottom: 24, left: 28, right: 28 }, maxZoom, duration: 650 });
    },
    setMarkers: (list: MarkerSpec[]) => {
      const keep = new Set(list.map(m => m.id));
      for (const [id, e] of markers) if (!keep.has(id)) { e.m.remove(); markers.delete(id); }
      for (const m of list) {
        const key = markerKey(m);
        const cur = markers.get(m.id);
        if (cur) {
          if (cur.key !== key) { renderMarker(cur.el, m); cur.key = key; }
          if (cur.lat !== m.lat || cur.lng !== m.lng) { cur.m.setLngLat([m.lng, m.lat]); cur.lat = m.lat; cur.lng = m.lng; }
          cur.el.style.zIndex = String(m.selected ? 999 : m.z ?? (m.kind === 'dest' ? 500 : 10));
          continue;
        }
        const wrap = document.createElement('div');
        renderMarker(wrap, m);
        wrap.style.zIndex = String(m.selected ? 999 : m.z ?? (m.kind === 'dest' ? 500 : 10));
        wrap.addEventListener('click', ev => { ev.stopPropagation(); markerCb(m.id); });
        const mk = new ml.Marker({ element: wrap, anchor: 'bottom' }).setLngLat([m.lng, m.lat]).addTo(map);
        markers.set(m.id, { m: mk, el: wrap, key, lat: m.lat, lng: m.lng });
      }
    },
    setUser: (u: UserSpec) => {
      userData = u;
      if (!u) { userMarker?.m.remove(); userMarker = null; drawOverlay(); return; }
      if (!userMarker) {
        const el = document.createElement('div');
        el.style.pointerEvents = 'none';
        renderUser(el, u.heading, u.stale);
        const m = new ml.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([u.lng, u.lat]).addTo(map);
        userMarker = { m, el };
      } else {
        userMarker.m.setLngLat([u.lng, u.lat]);
        renderUser(userMarker.el, u.heading, u.stale);
      }
      if (u.heading != null) userMarker.m.setRotation(u.heading);
      drawOverlay();
    },
    setRoutes: rl => { routeData = rl; drawOverlay(); },
    setTilt3D: on => map.easeTo({ pitch: on ? 60 : 0, zoom: on ? Math.max(map.getZoom(), 16.3) : map.getZoom(), duration: 650 }),
    resetNorth: () => map.easeTo({ bearing: 0, pitch: 0, duration: 450 }),
    setCamera: c => map.jumpTo({ center: [c.center.lng, c.center.lat], zoom: c.zoom ?? map.getZoom(), bearing: c.heading ?? map.getBearing() }),
    setLayer: () => { /* not available on the free map */ },
    onMarkerClick: cb => { markerCb = cb; },
    onGesture: cb => { gestureCb = cb; },
    onPoiClick: () => { /* not available */ },
    onMapClick: cb => { clickCb = cb; },
    onCamera: cb => { cameraCb = cb; },
    resize: () => map.resize(),
    destroy: () => { for (const e of markers.values()) e.m.remove(); markers.clear(); userMarker?.m.remove(); map.remove(); },
  };
  return adapter;
}
