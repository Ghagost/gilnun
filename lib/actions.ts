import { category, type CategoryKey } from './categories';
import { distance, fmtDist, type LatLng } from './geo';
import { googleSearchHere } from './links';
import { mapApi } from './map/instance';
import { searchCategory, searchText } from './places';
import { geo } from './store/geo';
import { places, toSaved, usePlaces } from './store/places';
import { ui, toast } from './store/ui';
import type { PlaceSummary, SavedPlace } from './types';

/** Where to search: the user's position when the map is near it, otherwise the map centre. */
export function searchCenter(): LatLng & { label: string } {
  const me = geo().me;
  const c = mapApi.center();
  if (me && (!c || distance(me, c) < 600)) return { lat: me.lat, lng: me.lng, label: '내 위치' };
  if (c) return { ...c, label: '지도 중심' };
  if (me) return { lat: me.lat, lng: me.lng, label: '내 위치' };
  return { lat: 35.6812, lng: 139.7671, label: '도쿄역' };
}

let searchSeq = 0;

export async function runCategory(cat: CategoryKey, opts: { keyword?: string; gType?: string; label?: string } = {}) {
  const C = category(cat);
  const center = searchCenter();
  const seq = ++searchSeq;
  const title = opts.label || `${C.label}${opts.keyword ? ` · ${opts.keyword}` : ''}`;
  places().setResults({ key: seq, title, meta: `${center.label} 주변에서 찾는 중…`, ids: [], loading: true, cat, center, gLink: googleSearchHere(C.ja, center), kind: opts.gType });
  goPanel({ type: 'results' });
  try {
    const r = await searchCategory(cat, center, { keyword: opts.keyword, gType: opts.gType });
    if (seq !== searchSeq) return;
    const ids = r.places.map(p => { places().register(p); return p.id; });
    places().setMarkers(ids);
    places().setResults({
      key: seq, title, ids, cat, center, kind: opts.gType,
      meta: `${center.label} 주변 ${fmtDist(r.radius)} · ${ids.length}곳${'fallback' in r && r.fallback ? ' · 무료 지도 데이터' : ''}`,
      gLink: googleSearchHere(C.ja, center),
    });
    const pts = r.places.slice(0, 12).map(p => ({ lat: p.lat, lng: p.lng }));
    if (center.label === '내 위치') pts.push({ lat: center.lat, lng: center.lng });
    mapApi.fit(pts);
  } catch (e) {
    if (seq !== searchSeq) return;
    places().setResults({ key: seq, title, ids: [], cat, center, error: '주변 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', gLink: googleSearchHere(C.ja, center) });
    console.warn('category search failed', e);
  }
}

export async function runTextSearch(q: string) {
  q = q.trim();
  if (!q) return;
  const seq = ++searchSeq;
  const bias = geo().me || mapApi.center();
  places().setResults({ key: seq, title: `“${q}”`, meta: '찾는 중…', ids: [], loading: true, query: q });
  goPanel({ type: 'results' });
  try {
    const r = await searchText(q, bias, { limit: 12 });
    if (seq !== searchSeq) return;
    const me = geo().me;
    const ids = r.places.map(p => { places().register({ ...p, distance: me ? Math.round(distance(me, p)) : p.distance }); return p.id; });
    places().setMarkers(ids);
    places().setResults({ key: seq, title: `“${q}”`, meta: ids.length ? `${ids.length}곳` : '', ids, query: q });
    mapApi.fit(r.places.slice(0, 8));
    if (ids.length === 1) openPlace(ids[0]);
  } catch {
    if (seq !== searchSeq) return;
    places().setResults({ key: seq, title: `“${q}”`, ids: [], query: q, error: '검색하지 못했어요. 인터넷 연결을 확인해 주세요.' });
  }
}

/** Opens a place sheet on the map tab and centres it. */
export function openPlace(id: string, opts: { fly?: boolean } = {}) {
  const p = places().byId[id];
  if (!p) return;
  places().addMarkers([id]);
  places().select(id);
  goPanel({ type: 'place', id });
  if (opts.fly !== false) mapApi.focus({ lat: p.lat, lng: p.lng }, Math.max(mapApi.get()?.getZoom() ?? 15, 16));
}

/** Pushes a panel on the map tab (switching tabs if needed). */
export function goPanel(panel: Parameters<ReturnType<typeof ui>['push']>[0]) {
  const s = ui();
  if (s.tab !== 'map') s.setTab('map', 'half');
  ui().push(panel);
}

export function showPlace(p: PlaceSummary): string {
  const ref = places().register(p);
  places().addMarkers([p.id]);
  return ref;
}

export function setDestination(p: SavedPlace | PlaceSummary | null, announce = true) {
  if (!p) { places().setDest(null); places().setRoutes([]); return; }
  const saved = 'source' in p ? toSaved(p) : p;
  places().setDest(saved);
  if (announce) toast(`목적지: ${saved.name}`);
}

export function startDirections(p: SavedPlace | PlaceSummary, mode?: 'transit' | 'walk' | 'drive' | 'taxi') {
  const to = 'source' in p ? toSaved(p) : p;
  setDestination(to, false);
  goPanel({ type: 'directions', to, mode });
}

export function clearSearch() {
  searchSeq++;
  const s = usePlaces.getState();
  s.setResults(null);
  s.setMarkers([]);
  s.select(null);
}
