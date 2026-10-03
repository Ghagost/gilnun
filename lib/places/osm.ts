import { category, categoryFromGoogleType, cuisineKo, type CategoryKey } from '../categories';
import { distance, inJapan, type LatLng } from '../geo';
import { parseOsmHours } from '../hours';
import type { PlaceDetails, PlaceSummary } from '../types';
import type { NearbyOpts, PlacesProvider, Suggestion, TextOpts } from './types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function fetchJSON<T = unknown>(url: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const { timeout = 15000, ...rest } = init;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...rest, signal: ctl.signal });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}

/* ---------- Overpass (queued, with mirrors) ---------- */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let ovQueue: Promise<unknown> = Promise.resolve();
export function overpass(ql: string): Promise<{ elements?: OsmEl[] }> {
  const job = async () => {
    let last: unknown;
    for (const ep of OVERPASS) {
      try {
        return await fetchJSON<{ elements?: OsmEl[] }>(ep, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: 'data=' + encodeURIComponent(ql), timeout: 25000 });
      } catch (e) { last = e; }
    }
    throw last || new Error('overpass');
  };
  const p = ovQueue.then(job, job);
  ovQueue = p.catch(() => undefined);
  return p;
}

type OsmEl = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

const BRANDS: [RegExp, string][] = [[/セブン-?イレブン|7-?eleven/i, '세븐일레븐'], [/ファミリーマート|familymart/i, '패밀리마트'], [/ローソン|lawson/i, '로손'], [/ミニストップ|ministop/i, '미니스톱'], [/デイリーヤマザキ/i, '데일리야마자키'], [/セイコーマート|seicomart/i, '세이코마트'], [/newdays/i, '뉴데이즈'], [/ドン・?キホーテ|don quijote/i, '돈키호테'], [/ゆうちょ|japan post bank/i, '유초은행'], [/セブン銀行|seven bank/i, '세븐은행'], [/トヨタレンタ|toyota rent/i, '토요타렌터카'], [/タイムズ|times car/i, '타임즈카'], [/ニッポンレンタカー|nippon rent/i, '닛폰렌터카'], [/オリックス|orix/i, '오릭스렌터카'], [/マツモトキヨシ|matsumoto/i, '마쓰모토키요시'], [/ダイソー|daiso/i, '다이소']];
function brandKo(t: Record<string, string>): string {
  const s = [t.brand, t['brand:ja'], t['brand:en'], t.name, t.operator].filter(Boolean).join(' ');
  for (const [re, ko] of BRANDS) if (re.test(s)) return ko;
  return '';
}
const OPS: [RegExp, string][] = [[/東日本旅客鉄道|JR East|JR東日本/i, 'JR동일본'], [/西日本旅客鉄道|JR West|JR西日本/i, 'JR서일본'], [/東海旅客鉄道|JR東海/i, 'JR도카이'], [/九州旅客鉄道|JR九州/i, 'JR규슈'], [/東京地下鉄|Tokyo Metro|東京メトロ/i, '도쿄메트로'], [/東京都交通局|Toei|都営/i, '도에이'], [/大阪市高速電気軌道|Osaka Metro/i, '오사카메트로'], [/京王/, '게이오'], [/小田急/, '오다큐'], [/東急/, '도큐'], [/西武/, '세이부'], [/東武/, '도부'], [/京成/, '게이세이'], [/京急|京浜急行/, '게이큐'], [/阪急/, '한큐'], [/阪神/, '한신'], [/南海/, '난카이'], [/近畿日本|近鉄/, '긴테쓰'], [/京阪/, '게이한'], [/名古屋市交通局/, '나고야시영지하철'], [/名古屋鉄道|名鉄/, '메이테쓰'], [/東京モノレール/, '도쿄모노레일'], [/ゆりかもめ/, '유리카모메'], [/横浜市交通局/, '요코하마시영지하철'], [/京都市交通局/, '교토시영지하철']];
function opKo(s?: string): string {
  if (!s) return '';
  for (const [re, ko] of OPS) if (re.test(s)) return ko;
  return s.length > 18 ? '' : s;
}
function sightKind(t: Record<string, string>): string {
  if (t.amenity === 'place_of_worship') return t.religion === 'shinto' ? '신사' : '절';
  if (t.historic === 'castle') return '성';
  return ({ museum: '박물관', viewpoint: '전망대', gallery: '미술관', theme_park: '테마파크', zoo: '동물원', aquarium: '수족관', attraction: '명소' } as Record<string, string>)[t.tourism] || '명소';
}
function infoOf(cat: CategoryKey, t: Record<string, string>): string {
  const out: string[] = [];
  if (cat === 'station' || cat === 'exit') {
    out.push(opKo(t.operator || t.network));
    if (cat === 'station' && (t.station === 'subway' || t.subway === 'yes')) out.push('지하철');
    if (t.level) out.push(`${t.level}층`);
    if (t.wheelchair === 'yes') out.push('휠체어 가능');
  } else if (cat === 'bus') {
    if (t.route_ref) out.push(`노선 ${t.route_ref}`);
    if (t.amenity === 'bus_station') out.push('버스터미널');
  } else if (cat === 'food' || cat === 'cafe') out.push(cuisineKo(t.cuisine));
  else if (cat === 'hotel') out.push(({ hotel: '호텔', hostel: '호스텔', guest_house: '게스트하우스', motel: '모텔', apartment: '아파트먼트' } as Record<string, string>)[t.tourism] || '숙소');
  else if (cat === 'sight') out.push(sightKind(t));
  else if (cat === 'airport') out.push(t.iata || '');
  else if (cat === 'locker' || cat === 'toilet') { if (t.fee === 'no') out.push('무료'); if (t.fee === 'yes') out.push('유료'); if (t.level) out.push(`${t.level}층`); }
  const b = brandKo(t);
  if (b && ['conv', 'shop', 'rental', 'atm', 'pharmacy', 'exchange'].includes(cat)) out.push(b);
  return [...new Set(out.filter(Boolean))].join(' · ');
}
function addrOf(t: Record<string, string>): string {
  if (t['addr:full']) return t['addr:full'];
  return [t['addr:province'], t['addr:city'], t['addr:quarter'] || t['addr:suburb'], t['addr:neighbourhood'], t['addr:block_number'], t['addr:housenumber']].filter(Boolean).join(' ');
}

export function normEl(el: OsmEl, cat: CategoryKey, center: LatLng): PlaceSummary | null {
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const t = el.tags || {};
  const ja = t['name:ja'] || t.name || '';
  const ko = t['name:ko'] || '';
  let name = ko || ja || t['name:en'] || '';
  let nameLocal = ko && ja && ja !== ko ? ja : undefined;
  if (cat === 'exit') {
    const ref = t.ref || t['ref:ja'] || '';
    name = ref ? `${ref} 출구` : ko || '출구';
    nameLocal = t.name || undefined;
  }
  if (!name) {
    if (cat === 'conv' && brandKo(t)) name = brandKo(t);
    else if (category(cat).unnamedOk) name = category(cat).label;
    else return null;
  }
  const hours = parseOsmHours(t.opening_hours) || undefined;
  return {
    id: `o:${(el.type || 'n')[0]}${el.id}`, source: 'osm', name, nameLocal, lat, lng, category: cat,
    info: infoOf(cat, t) || undefined, address: addrOf(t) || undefined, hours, hoursRaw: t.opening_hours, utcOffset: 540,
    distance: Math.round(distance(center, { lat, lng })),
    phone: t.phone || t['contact:phone'] || undefined, website: t.website || t['contact:website'] || undefined,
  };
}

export function kwFilter(keyword?: string): string {
  const parts = String(keyword || '').split(/[|,/、，]+/).map(s => s.replace(/[\\"'.*+?^${}()[\]]/g, ' ').trim()).filter(Boolean).slice(0, 6);
  return parts.length ? `[~"^(name|name:ja|name:en|name:ko|cuisine|brand|brand:ja|operator)$"~"${parts.join('|')}",i]` : '';
}

/* ---------- geocoding: Photon (fast, prefix) + Nominatim (Korean names, 1 req/s) ---------- */
let nomChain: Promise<unknown> = Promise.resolve();
let nomLast = 0;
function nomTurn(): Promise<void> {
  const p = nomChain.then(() => sleep(Math.max(0, nomLast + 1100 - Date.now()))).then(() => { nomLast = Date.now(); });
  nomChain = p.catch(() => undefined);
  return p;
}

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string | number | undefined> };
function osmGuess(key?: string, val?: string): CategoryKey {
  if (!key) return 'place';
  if (key === 'railway' && /station|halt/.test(val || '')) return 'station';
  if (key === 'aeroway') return 'airport';
  if (key === 'tourism' && /hotel|hostel|guest_house|motel|apartment/.test(val || '')) return 'hotel';
  if (key === 'tourism' || key === 'historic') return 'sight';
  if (key === 'amenity') {
    if (/restaurant|fast_food|food_court/.test(val || '')) return 'food';
    if (val === 'cafe') return 'cafe';
    if (val === 'place_of_worship') return 'sight';
    if (val === 'car_rental') return 'rental';
    if (val === 'pharmacy') return 'pharmacy';
    if (val === 'hospital' || val === 'clinic') return 'hospital';
  }
  if (key === 'shop' && val === 'convenience') return 'conv';
  if (key === 'shop') return 'shop';
  if (key === 'highway' && val === 'bus_stop') return 'bus';
  return categoryFromGoogleType(val || null);
}

async function photon(q: string, bias: LatLng | null, limit: number): Promise<PlaceSummary[]> {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', String(limit));
  if (bias) { u.searchParams.set('lat', bias.lat.toFixed(5)); u.searchParams.set('lon', bias.lng.toFixed(5)); }
  const j = await fetchJSON<{ features?: PhotonFeature[] }>(u.toString(), { timeout: 10000 });
  return (j.features || []).map(f => {
    const p = f.properties || {};
    const lat = f.geometry.coordinates[1], lng = f.geometry.coordinates[0];
    return {
      id: `o:${String(p.osm_type || 'N')[0].toLowerCase()}${p.osm_id}`, source: 'geo' as const,
      name: String(p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || q), lat, lng,
      category: osmGuess(p.osm_key as string, p.osm_value as string),
      info: [...new Set([p.district, p.city, p.state].filter(Boolean))].join(', ') || undefined,
      distance: bias ? Math.round(distance(bias, { lat, lng })) : undefined,
    };
  });
}

type NomResult = { osm_type?: string; osm_id?: number; lat: string; lon: string; name?: string; display_name?: string; category?: string; type?: string; namedetails?: Record<string, string> };
async function nominatim(q: string, bias: LatLng | null, limit: number): Promise<PlaceSummary[]> {
  await nomTurn();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('accept-language', 'ko,ja,en');
  u.searchParams.set('namedetails', '1');
  if (bias) { const d = 0.35; u.searchParams.set('viewbox', `${bias.lng - d},${bias.lat + d},${bias.lng + d},${bias.lat - d}`); }
  if (inJapan(bias)) u.searchParams.set('countrycodes', 'jp');
  const j = await fetchJSON<NomResult[]>(u.toString(), { timeout: 10000 });
  return (j || []).map(x => {
    const nd = x.namedetails || {};
    const name = nd['name:ko'] || x.name || String(x.display_name || q).split(',')[0];
    const ja = nd['name:ja'] || nd.name || '';
    const lat = Number(x.lat), lng = Number(x.lon);
    return {
      id: `o:${(x.osm_type || 'n')[0]}${x.osm_id}`, source: 'geo' as const, name, nameLocal: ja && ja !== name ? ja : undefined, lat, lng,
      category: osmGuess(x.category, x.type), info: String(x.display_name || '').split(',').slice(1, 4).join(',').trim() || undefined,
      distance: bias ? Math.round(distance(bias, { lat, lng })) : undefined,
    };
  });
}

export async function geocode(q: string, bias: LatLng | null, limit = 6): Promise<PlaceSummary[]> {
  const order = /[가-힣]/.test(q) ? [nominatim, photon] : [photon, nominatim];
  let err: unknown;
  for (const f of order) {
    try { const r = await f(q, bias, limit); if (r.length) return r; } catch (e) { err = e; }
  }
  if (err) throw err;
  return [];
}

export async function reverseArea(p: LatLng): Promise<{ label: string; city: string; cc: string } | null> {
  try {
    await nomTurn();
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ja&lat=${p.lat.toFixed(5)}&lon=${p.lng.toFixed(5)}`;
    const j = await fetchJSON<{ address?: Record<string, string> }>(u, { timeout: 9000 });
    const a = j.address || {};
    return {
      label: [...new Set([a.city || a.town || a.village || a.county, a.city_district || a.suburb || a.quarter || a.neighbourhood].filter(Boolean))].join(' '),
      city: a.city || a.town || a.village || '',
      cc: String(a.country_code || '').toUpperCase(),
    };
  } catch { return null; }
}

export class OsmPlaces implements PlacesProvider {
  readonly kind = 'osm' as const;

  async nearby(catKey: CategoryKey, center: LatLng, o: NearbyOpts = {}) {
    const C = category(catKey);
    if (!C.osm) return { places: [], radius: 0 };
    const ladder = o.radius ? [Math.min(o.radius, catKey === 'airport' ? 200000 : 20000)] : C.ladder;
    const kf = kwFilter(o.keyword);
    let places: PlaceSummary[] = [];
    let used = ladder[0];
    for (const r of ladder) {
      used = r;
      const a = `(around:${Math.round(r)},${center.lat.toFixed(6)},${center.lng.toFixed(6)})`;
      let body = C.osm(a);
      if (kf) body = body.replace(/;/g, kf + ';');
      const j = await overpass(`[out:json][timeout:20];(${body});out center 300;`);
      const seen = new Set<string>();
      places = (j.elements || []).map(el => normEl(el, catKey, center)).filter((p): p is PlaceSummary => {
        if (!p) return false;
        const k = `${p.name}@${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (places.length >= (kf ? 3 : 5)) break;
    }
    places.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return { places: places.slice(0, o.limit ?? 20), radius: used };
  }

  async text(query: string, bias: LatLng | null, o: TextOpts = {}) {
    return (await geocode(query, bias, o.limit ?? 8));
  }

  async autocomplete(input: string, bias: LatLng | null): Promise<Suggestion[]> {
    if (input.trim().length < 2) return [];
    try {
      const r = await photon(input, bias, 7);
      return r.map(p => ({ id: p.id, kind: 'place' as const, main: p.name, secondary: p.info, distance: p.distance, lat: p.lat, lng: p.lng, category: p.category }));
    } catch { return []; }
  }

  async pick(s: Suggestion): Promise<PlaceSummary | null> {
    if (s.lat == null || s.lng == null) return null;
    return { id: s.id, source: 'geo', name: s.main, lat: s.lat, lng: s.lng, category: s.category || 'place', info: s.secondary, distance: s.distance };
  }

  async details(p: PlaceSummary): Promise<PlaceDetails> {
    return { ...p, fetchedAt: Date.now() };
  }

  async localName(p: PlaceSummary) {
    return p.nameLocal ? { name: p.nameLocal, address: p.address } : null;
  }
}
