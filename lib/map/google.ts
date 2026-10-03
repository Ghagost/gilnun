import type { LatLng } from '../geo';
import type { RouteLine } from '../types';
import { markerKey, renderMarker, renderUser } from './markers';
import type { Insets, MapAdapter, MarkerSpec, UserSpec } from './types';

type Entry = { marker: google.maps.marker.AdvancedMarkerElement; el: HTMLElement; key: string; lat: number; lng: number };

export function createGoogleMap(el: HTMLElement, opts: { center: LatLng; zoom: number; mapId?: string | null; scheme: 'auto' | 'light' | 'dark'; interactive?: boolean }): MapAdapter {
  const g = google.maps;
  const scheme = g.ColorScheme ? (opts.scheme === 'dark' ? g.ColorScheme.DARK : opts.scheme === 'light' ? g.ColorScheme.LIGHT : g.ColorScheme.FOLLOW_SYSTEM) : undefined;
  const interactive = opts.interactive !== false;
  const mapOpts: google.maps.MapOptions = {
    center: opts.center,
    zoom: opts.zoom,
    mapId: opts.mapId || 'DEMO_MAP_ID',
    disableDefaultUI: true,
    clickableIcons: interactive,
    gestureHandling: interactive ? 'greedy' : 'none',
    isFractionalZoomEnabled: true,
    tiltInteractionEnabled: interactive,
    headingInteractionEnabled: interactive,
    keyboardShortcuts: interactive,
    disableDoubleClickZoom: !interactive,
  };
  if (g.RenderingType) mapOpts.renderingType = g.RenderingType.VECTOR;
  if (scheme) mapOpts.colorScheme = scheme;
  const map = new g.Map(el, mapOpts);

  let insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const markers = new Map<string, Entry>();
  let markerCb: (id: string) => void = () => {};
  let gestureCb: () => void = () => {};
  let poiCb: (id: string, at: LatLng) => void = () => {};
  let clickCb: (at: LatLng) => void = () => {};
  let cameraCb: () => void = () => {};
  let user: { marker: google.maps.marker.AdvancedMarkerElement; el: HTMLElement; circle: google.maps.Circle; heading: number | null } | null = null;
  let lines: google.maps.Polyline[] = [];
  const layers: { transit?: google.maps.TransitLayer; traffic?: google.maps.TrafficLayer } = {};

  const listeners = [
    map.addListener('dragstart', () => gestureCb()),
    map.addListener('click', (e: google.maps.MapMouseEvent & { placeId?: string; stop?: () => void }) => {
      const at = e.latLng ? { lat: e.latLng.lat(), lng: e.latLng.lng() } : opts.center;
      if (e.placeId) { e.stop?.(); poiCb(e.placeId, at); return; }
      clickCb(at);
    }),
    map.addListener('idle', () => cameraCb()),
    map.addListener('heading_changed', () => rotateUser()),
  ];

  function rotateUser() {
    if (!user) return;
    const inner = user.el.firstChild as HTMLElement | null;
    if (inner) inner.style.transform = user.heading == null ? '' : `rotate(${user.heading - (map.getHeading() || 0)}deg)`;
  }

  function offsetCenter(p: LatLng, zoom: number): google.maps.LatLngLiteral {
    const proj = map.getProjection();
    if (!proj) return p;
    const scale = 2 ** zoom;
    const wp = proj.fromLatLngToPoint(new g.LatLng(p.lat, p.lng));
    if (!wp) return p;
    const x = wp.x - (insets.left - insets.right) / 2 / scale;
    const y = wp.y - (insets.top - insets.bottom) / 2 / scale;
    const ll = proj.fromPointToLatLng(new g.Point(x, y));
    return ll ? { lat: ll.lat(), lng: ll.lng() } : p;
  }

  function addListenerSafe(m: google.maps.marker.AdvancedMarkerElement, id: string) {
    const h = () => markerCb(id);
    const anyM = m as unknown as { addEventListener?: (t: string, f: () => void) => void; addListener?: (t: string, f: () => void) => void };
    if (typeof anyM.addEventListener === 'function') anyM.addEventListener('gmp-click', h);
    else anyM.addListener?.('click', h);
  }

  const adapter: MapAdapter = {
    engine: 'google',
    getCenter: () => { const c = map.getCenter(); return c ? { lat: c.lat(), lng: c.lng() } : opts.center; },
    getZoom: () => map.getZoom() ?? opts.zoom,
    getHeading: () => map.getHeading() || 0,
    isTilted: () => (map.getTilt() || 0) > 5,
    setInsets: i => { insets = i; },
    focus: (p, zoom, animate = true) => {
      const z = zoom ?? Math.max(map.getZoom() ?? 15, 15);
      const c = offsetCenter(p, z);
      if (animate && Math.abs((map.getZoom() ?? z) - z) < 0.01) map.panTo(c);
      else map.moveCamera({ center: c, zoom: z });
    },
    fitPoints: (points, maxZoom = 17) => {
      const pts = points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (!pts.length) return;
      if (pts.length === 1) { adapter.focus(pts[0], Math.max(map.getZoom() ?? 15, 16)); return; }
      const b = new g.LatLngBounds();
      pts.forEach(p => b.extend(p));
      map.fitBounds(b, { top: insets.top + 36, bottom: insets.bottom + 24, left: insets.left + 28, right: insets.right + 28 });
      const once = g.event.addListenerOnce(map, 'idle', () => { if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom); });
      setTimeout(() => g.event.removeListener(once), 4000);
    },
    setMarkers: (list: MarkerSpec[]) => {
      const keep = new Set(list.map(m => m.id));
      for (const [id, e] of markers) if (!keep.has(id)) { e.marker.map = null; markers.delete(id); }
      for (const m of list) {
        const key = markerKey(m);
        const cur = markers.get(m.id);
        if (cur) {
          if (cur.key !== key) { renderMarker(cur.el, m); cur.key = key; }
          if (cur.lat !== m.lat || cur.lng !== m.lng) { cur.marker.position = { lat: m.lat, lng: m.lng }; cur.lat = m.lat; cur.lng = m.lng; }
          cur.marker.zIndex = m.selected ? 999 : m.z ?? (m.kind === 'dest' ? 500 : 10);
          continue;
        }
        const el = document.createElement('div');
        renderMarker(el, m);
        const marker = new g.marker.AdvancedMarkerElement({ map, position: { lat: m.lat, lng: m.lng }, content: el, title: m.title || '', zIndex: m.selected ? 999 : m.z ?? (m.kind === 'dest' ? 500 : 10), gmpClickable: true } as google.maps.marker.AdvancedMarkerElementOptions);
        addListenerSafe(marker, m.id);
        markers.set(m.id, { marker, el, key, lat: m.lat, lng: m.lng });
      }
    },
    setUser: (u: UserSpec) => {
      if (!u) {
        if (user) { user.marker.map = null; user.circle.setMap(null); user = null; }
        return;
      }
      if (!user) {
        const el = document.createElement('div');
        el.style.transform = 'translateY(50%)';
        el.style.pointerEvents = 'none';
        renderUser(el, u.heading, u.stale);
        const marker = new g.marker.AdvancedMarkerElement({ map, position: { lat: u.lat, lng: u.lng }, content: el, zIndex: 1000 } as google.maps.marker.AdvancedMarkerElementOptions);
        const circle = new g.Circle({ map, center: { lat: u.lat, lng: u.lng }, radius: Math.min(u.acc || 0, 2000), strokeColor: '#2F6BFF', strokeOpacity: 0.35, strokeWeight: 1, fillColor: '#2F6BFF', fillOpacity: 0.12, clickable: false });
        user = { marker, el, circle, heading: u.heading };
      } else {
        user.marker.position = { lat: u.lat, lng: u.lng };
        user.circle.setCenter({ lat: u.lat, lng: u.lng });
        user.circle.setRadius(Math.min(u.acc || 0, 2000));
        user.heading = u.heading;
        renderUser(user.el, u.heading, u.stale);
      }
      rotateUser();
    },
    setRoutes: (rl: RouteLine[]) => {
      lines.forEach(l => l.setMap(null));
      lines = rl.map(r => new g.Polyline({
        map,
        path: r.points,
        strokeColor: r.color,
        strokeWeight: r.width ?? 6,
        strokeOpacity: r.dashed ? 0 : 0.9,
        icons: r.dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: r.color, scale: 3 }, offset: '0', repeat: '12px' }] : undefined,
        clickable: false,
        zIndex: 5,
      }));
    },
    setTilt3D: on => {
      if (on) map.moveCamera({ tilt: 60, zoom: Math.max(map.getZoom() ?? 16, 17) });
      else map.moveCamera({ tilt: 0, heading: 0 });
    },
    resetNorth: () => map.moveCamera({ heading: 0, tilt: 0 }),
    setCamera: c => map.moveCamera({ center: c.center, zoom: c.zoom ?? map.getZoom() ?? opts.zoom, heading: c.heading ?? map.getHeading() ?? 0 }),
    setLayer: (layer, on) => {
      if (layer === 'transit') {
        if (on) { layers.transit ||= new g.TransitLayer(); layers.transit.setMap(map); } else layers.transit?.setMap(null);
      } else {
        if (on) { layers.traffic ||= new g.TrafficLayer(); layers.traffic.setMap(map); } else layers.traffic?.setMap(null);
      }
    },
    onMarkerClick: cb => { markerCb = cb; },
    onGesture: cb => { gestureCb = cb; },
    onPoiClick: cb => { poiCb = cb; },
    onMapClick: cb => { clickCb = cb; },
    onCamera: cb => { cameraCb = cb; },
    resize: () => { /* Google handles container resizes */ },
    destroy: () => {
      listeners.forEach(l => l.remove());
      for (const e of markers.values()) e.marker.map = null;
      markers.clear();
      if (user) { user.marker.map = null; user.circle.setMap(null); }
      lines.forEach(l => l.setMap(null));
      layers.transit?.setMap(null); layers.traffic?.setMap(null);
      try { g.event.clearInstanceListeners(map); } catch { /* ignore */ }
      el.innerHTML = '';
    },
  };
  return adapter;
}
