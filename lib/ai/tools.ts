import { CATEGORY_KEYS, category, type CategoryKey } from '../categories';
import { distance, walkMinutes, type LatLng } from '../geo';
import { fmtDuration, fmtHM, isoDate, parseJst, yenWithWon } from '../format';
import { statusAt, statusLabel } from '../hours';
import { googleDirections } from '../links';
import { mapApi } from '../map/instance';
import { googleActive, placeDetails, searchCategory, searchText } from '../places';
import { setDestination, searchCenter, showPlace } from '../actions';
import { api } from '../api';
import { transitRoutes } from '../routes';
import { geo } from '../store/geo';
import { placeByRef, places, toSaved } from '../store/places';
import { runtime, type Weather } from '../store/runtime';
import { settings } from '../store/settings';
import { tripStore } from '../store/trip';
import { ui } from '../store/ui';
import type { PlaceSummary, ReservationKind, SavedPlace } from '../types';
import type { AgentTool, ToolContext } from './agent';
import { geminiWebSearch } from './gemini';
import { fxRate } from './prompts';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

function pin(ctx: ToolContext, p: PlaceSummary): string {
  if (ctx.fresh) { places().setMarkers([]); ctx.fresh = false; }
  const ref = showPlace(p);
  ctx.pinned.push(ref);
  return ref;
}

function centerFor(near: unknown): LatLng {
  if (near === 'destination' && places().dest) return places().dest!;
  if (near === 'map') return mapApi.center() || searchCenter();
  return geo().me || searchCenter();
}

function compact(p: PlaceSummary, ref: string) {
  const st = p.hours ? statusLabel(statusAt(p.hours, new Date(), p.utcOffset ?? 540)) : null;
  const me = geo().me;
  const d = me ? Math.round(distance(me, p)) : p.distance;
  return {
    ref,
    name: p.name,
    ja: p.nameLocal || undefined,
    type: p.typeLabel || category(p.category).label,
    rating: p.rating,
    reviews: p.ratingCount,
    price_level: p.priceLevel,
    open: st && st.tone !== 'unknown' ? st.text : undefined,
    info: p.info || undefined,
    dist_m: d,
    walk_min: d != null ? walkMinutes(d) : undefined,
  };
}

async function resolvePlace(args: Record<string, unknown>, ctx: ToolContext): Promise<PlaceSummary | null> {
  const ref = str(args.ref, 20);
  if (ref) { const p = placeByRef(ref); if (p) return p; }
  const q = str(args.query || args.name, 160);
  if (!q) return null;
  const bias = geo().me || mapApi.center();
  const r = await searchText(q, bias, { limit: 1 });
  const p = r.places[0];
  if (!p) return null;
  pin(ctx, p);
  return places().byId[p.id] || p;
}

/** Google Maps Grounding Lite through the server (keeps Google's terms for AI answers). */
async function groundedSearch(query: string, center: LatLng, radius: number, ctx: ToolContext) {
  const j = await api<{ text: string; places: { placeId?: string; name: string; lat?: number; lng?: number; mapsUri?: string; summary?: string }[]; sources: { title: string; url: string }[] }>('/api/maps/grounding', {
    method: 'POST', body: JSON.stringify({ query, lat: center.lat, lng: center.lng, radius, language: 'ko' }), timeout: 30000, signal: ctx.signal,
  });
  const out: { ref: string; name: string; dist_m?: number }[] = [];
  for (const gp of j.places.slice(0, 10)) {
    if (typeof gp.lat !== 'number' || typeof gp.lng !== 'number') continue;
    const p: PlaceSummary = { id: gp.placeId ? `g:${gp.placeId}` : `gr:${gp.name}@${gp.lat.toFixed(4)},${gp.lng.toFixed(4)}`, source: 'grounding', placeId: gp.placeId, name: gp.name, lat: gp.lat, lng: gp.lng, category: 'place', googleMapsUri: gp.mapsUri, note: gp.summary };
    const ref = pin(ctx, p);
    out.push({ ref, name: gp.name, dist_m: geo().me ? Math.round(distance(geo().me!, p)) : undefined });
  }
  for (const s of j.sources) if (!ctx.mapsSources.some(x => x.url === s.url)) ctx.mapsSources.push(s);
  return { source: 'Google Maps', grounded_text: j.text.slice(0, 5000), places: out, note: '답변에 장소 ref를 적어. 출처 링크는 앱이 답변 아래에 붙여.' };
}

export function buildTools(): AgentTool[] {
  const cfg = runtime().config;
  const tools: AgentTool[] = [
    {
      name: 'search_places',
      description: '실제 지도 데이터로 주변 장소를 찾아 지도에 번호 핀(ref)으로 표시하고 결과를 돌려줘. category만 주면 그 종류를 가까운 순으로, query를 주면 이름·요리·키워드로 찾아(예: "라멘", "一蘭", "야경 좋은 바"). 결과의 ref를 답변에 써.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '찾을 키워드나 이름. 일본어나 영어가 더 정확할 때가 많아.' },
          category: { type: 'string', enum: CATEGORY_KEYS, description: 'station=역, exit=역 출구, food=식당, cafe=카페, conv=편의점, sight=관광지, hotel=숙소, bus=버스, shop=쇼핑, pharmacy=약국, locker=코인로커, atm=ATM, toilet=화장실, rental=렌터카, airport=공항, exchange=환전, hospital=병원, police=경찰·파출소' },
          near: { type: 'string', enum: ['me', 'map', 'destination'], description: '기준 위치: me=내 위치(기본), map=보고 있는 지도 중심, destination=목적지 주변' },
          open_now: { type: 'boolean', description: '지금 영업 중인 곳만' },
          min_rating: { type: 'number', description: '최소 평점 (예: 4.0)' },
          radius_m: { type: 'number', description: '반경(m). 생략하면 자동' },
        },
      },
      run: async (a, ctx) => {
        const cat = CATEGORY_KEYS.includes(a.category as CategoryKey) ? (a.category as CategoryKey) : null;
        const query = str(a.query, 120);
        if (!cat && !query) throw new Error('query나 category 중 하나는 있어야 해');
        const center = centerFor(a.near);
        const radius = num(a.radius_m);
        ctx.step(`${query || category(cat!).label} 찾는 중…`);
        if (cfg?.google.grounding && googleActive() && cat !== 'exit') {
          try {
            const q = [query, cat ? category(cat).ja : ''].filter(Boolean).join(' ');
            const r = await groundedSearch(q, center, radius ?? (cat ? category(cat).ladder[1] ?? 1500 : 2000), ctx);
            ctx.step(`→ 구글 지도에서 ${r.places.length}곳`);
            return r;
          } catch { /* fall back to Places search */ }
        }
        let list: PlaceSummary[];
        if (cat && !query) {
          const r = await searchCategory(cat, center, { radius });
          list = r.places;
        } else {
          const r = await searchText(cat ? `${query} ${category(cat).ja}` : query, center, { limit: 10, openNow: !!a.open_now, minRating: num(a.min_rating), radius });
          list = r.places;
        }
        if (a.open_now) list = list.filter(p => !p.hours || statusAt(p.hours, new Date(), p.utcOffset ?? 540)?.open !== false);
        const minR = num(a.min_rating);
        if (minR) list = list.filter(p => (p.rating ?? 0) >= minR);
        const out = list.slice(0, 10).map(p => compact(places().byId[p.id] || p, pin(ctx, p)));
        ctx.step(`→ ${out.length}곳`);
        if (out.length) mapApi.fit(list.slice(0, 10));
        return { count: out.length, results: out };
      },
    },
    {
      name: 'place_details',
      description: '지도에 있는 장소(ref)의 영업시간, 주소, 전화, 예약 가능 여부, 결제 수단을 확인해.',
      parameters: { type: 'object', properties: { ref: { type: 'string', description: '예: P3' } }, required: ['ref'] },
      run: async (a, ctx) => {
        const p = placeByRef(str(a.ref, 20));
        if (!p) throw new Error('그 ref의 장소가 지도에 없어');
        ctx.step(`${p.name} 정보 확인 중…`);
        const d = await placeDetails(p);
        places().update(p.id, d);
        const st = statusLabel(statusAt(d.hours, new Date(), d.utcOffset ?? 540));
        return {
          ref: str(a.ref, 20), name: d.name, ja: d.nameLocal, address: d.address, open_status: st.text, weekly_hours: d.weekdayText?.slice(0, 7),
          phone: d.phone, website: d.website, reservable: d.reservable, payment: d.payment, wheelchair: d.access?.entrance,
          vegetarian: d.dining?.vegetarian,
        };
      },
    },
    {
      name: 'set_destination',
      description: '목적지를 정해. ref가 있으면 그걸로, 없으면 query(이름)로 찾아서. 앱이 길찾기 버튼과 카메라 길안내 화살표를 띄워.',
      parameters: { type: 'object', properties: { ref: { type: 'string' }, query: { type: 'string', description: '일본어·영어 이름이 정확해' } } },
      run: async (a, ctx) => {
        const p = await resolvePlace(a, ctx);
        if (!p) throw new Error('장소를 찾지 못했어. ref나 정확한 이름을 줘');
        setDestination(p);
        const ref = places().refOf[p.id] || showPlace(p);
        if (!ctx.pinned.includes(ref)) ctx.pinned.push(ref);
        const me = geo().me;
        const d = me ? Math.round(distance(me, p)) : undefined;
        ctx.step(`목적지: ${p.name}`);
        return { ok: true, ref, name: p.name, dist_m: d, walk_min: d != null ? walkMinutes(d) : undefined };
      },
    },
    {
      name: 'get_directions',
      description: '목적지까지 가는 경로를 찾아. transit=전철·버스(일본 실제 시간표, 요금, 승강장, 출구), walk=도보, drive=차. last_train=true면 오늘 막차 경로.',
      parameters: {
        type: 'object',
        properties: {
          to_ref: { type: 'string' }, to_query: { type: 'string' },
          mode: { type: 'string', enum: ['transit', 'walk', 'drive'] },
          depart_at: { type: 'string', description: '"HH:MM" (일본 시각) 또는 "YYYY-MM-DDTHH:MM". 생략하면 지금' },
          last_train: { type: 'boolean' },
        },
        required: ['mode'],
      },
      run: async (a, ctx) => {
        const to = await resolvePlace({ ref: a.to_ref, query: a.to_query }, ctx) || (places().dest ? { ...places().dest!, source: 'custom', id: places().dest!.id } as PlaceSummary : null);
        if (!to) throw new Error('목적지를 알려줘 (to_ref나 to_query)');
        const from = geo().me || mapApi.center();
        if (!from) throw new Error('현재 위치를 몰라');
        setDestination(to, false);
        const mode = a.mode === 'walk' || a.mode === 'drive' ? a.mode : 'transit';
        const link = googleDirections({ ...to, placeId: to.placeId }, mode === 'walk' ? 'walking' : mode === 'drive' ? 'driving' : 'transit', geo().me ? { lat: from.lat, lng: from.lng } : null);
        const straight = Math.round(distance(from, to));
        if (mode === 'transit') {
          if (!cfg?.transit) return { available: false, reason: '이 앱 서버에 일본 열차 경로 기능이 꺼져 있어', google_maps_link: link, straight_m: straight, note: '노선은 일반 지식으로 추정해서 알려주고, 정확한 시간은 앱의 대중교통 버튼(구글지도)으로 확인하라고 해' };
          let at = new Date();
          const dep = str(a.depart_at, 20);
          if (/^\d{2}:\d{2}$/.test(dep)) at = parseJst(isoDate(new Date()), dep) || at;
          else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dep)) at = parseJst(dep.slice(0, 10), dep.slice(11, 16)) || at;
          ctx.step(a.last_train ? '막차 확인 중…' : '열차 경로 찾는 중…');
          const routes = await transitRoutes(from, to, at, a.last_train ? 'last' : 'depart', ctx.signal);
          if (!routes.length) return { available: true, routes: [], google_maps_link: link };
          const best = routes[0];
          if (best.path?.length) places().setRoutes([{ id: 'transit', points: best.path, color: '#0B5FB0', width: 6 }]);
          const rate = fxRate();
          return {
            available: true,
            routes: routes.slice(0, 3).map(r => ({
              total: fmtDuration(r.minutes), depart: r.departure, arrive: r.arrival, transfers: r.transfers,
              fare_ic: r.fareIc != null ? yenWithWon(r.fareIc, rate) : undefined, fare_ticket: r.fareTicket != null ? yenWithWon(r.fareTicket, rate) : undefined,
              legs: r.legs.map(l => ({ kind: l.kind, line: l.line, direction: l.direction, from: l.from, to: l.to, dep: l.fromTime, arr: l.toTime, min: l.minutes, platform: l.platformFrom, exit: l.exitTo })),
            })),
            note: '핵심(타는 노선·방향·승강장·출구·요금)만 짧게 말해. 앱의 "경로 보기" 버튼에 자세한 경로가 있어.',
          };
        }
        const { simpleRoute } = await import('../routes');
        ctx.step(mode === 'walk' ? '도보 경로 계산 중…' : '자동차 경로 계산 중…');
        const r = await simpleRoute(from, to, mode);
        places().setRoutes([{ id: mode, points: r.path, color: mode === 'walk' ? '#2F6BFF' : '#111214', width: 6, dashed: r.source === 'estimate' }]);
        return { minutes: r.minutes, meters: r.meters, source: r.source === 'google' ? 'Google 경로' : '직선거리 추정', google_maps_link: link };
      },
    },
    {
      name: 'add_to_trip',
      description: '장소를 여행 일정의 특정 날짜에 추가해. 진행 중인 일정이 없으면 먼저 create_trip을 써.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' }, query: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' }, day_number: { type: 'number', description: '1부터 시작하는 일차' },
          time: { type: 'string', description: 'HH:MM' }, note: { type: 'string' },
        },
      },
      run: async (a, ctx) => {
        const ts = tripStore();
        const trip = ts.trips.find(t => t.id === ts.activeTripId) || ts.trips[0];
        if (!trip) throw new Error('일정이 없어. create_trip으로 먼저 만들어');
        const p = await resolvePlace(a, ctx);
        if (!p) throw new Error('장소를 찾지 못했어');
        let date = str(a.date, 10);
        const dn = num(a.day_number);
        if (!trip.days.some(d => d.date === date)) date = dn && trip.days[dn - 1] ? trip.days[dn - 1].date : (trip.days.find(d => d.date === isoDate(new Date()))?.date || trip.days[0].date);
        const time = /^\d{2}:\d{2}$/.test(str(a.time, 5)) ? str(a.time, 5) : undefined;
        ts.addStop(trip.id, date, toSaved(p), { time, note: str(a.note, 200) || undefined });
        ctx.step(`일정에 추가: ${p.name}`);
        return { ok: true, trip: trip.title, date, name: p.name };
      },
    },
    {
      name: 'create_trip',
      description: '새 여행 일정을 만들고 날짜별 장소를 넣어. 장소는 이름(query)으로 주면 앱이 지도에서 찾아 넣어.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' }, city: { type: 'string' },
          start: { type: 'string', description: 'YYYY-MM-DD' }, end: { type: 'string', description: 'YYYY-MM-DD' },
          days: {
            type: 'array',
            description: '날짜별 계획 (최대 10일, 하루 최대 8곳)',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                stops: { type: 'array', items: { type: 'object', properties: { query: { type: 'string' }, time: { type: 'string' }, note: { type: 'string' } }, required: ['query'] } },
              },
              required: ['date'],
            },
          },
        },
        required: ['title', 'start', 'end'],
      },
      run: async (a, ctx) => {
        const start = str(a.start, 10), end = str(a.end, 10);
        if (!parseJst(start) || !parseJst(end)) throw new Error('start/end는 YYYY-MM-DD');
        const ts = tripStore();
        const id = ts.createTrip({ title: str(a.title, 60) || '새 여행', city: str(a.city, 40), start, end });
        const days = Array.isArray(a.days) ? (a.days as Record<string, unknown>[]).slice(0, 10) : [];
        let added = 0;
        const missing: string[] = [];
        for (const d of days) {
          const stops = Array.isArray(d.stops) ? (d.stops as Record<string, unknown>[]).slice(0, 8) : [];
          for (const s of stops) {
            const q = str(s.query, 120);
            if (!q) continue;
            ctx.step(`일정 장소 찾는 중: ${q}`);
            try {
              const r = await searchText(q, mapApi.center() || geo().me, { limit: 1, radius: 30000 });
              const p = r.places[0];
              if (!p) { missing.push(q); continue; }
              pin(ctx, p);
              tripStore().addStop(id, str(d.date, 10), toSaved(p), { time: /^\d{2}:\d{2}$/.test(str(s.time, 5)) ? str(s.time, 5) : undefined, note: str(s.note, 200) || undefined });
              added++;
            } catch { missing.push(q); }
          }
        }
        return { ok: true, trip_id: id, stops_added: added, not_found: missing.slice(0, 10), note: '사용자에게 일정 탭에서 확인·수정할 수 있다고 알려줘' };
      },
    },
    {
      name: 'save_reservation',
      description: '사용자가 한 예약(식당·숙소·액티비티·교통·렌터카)을 앱의 예약함에 저장해. 날짜·시간·인원·예약번호를 넣어.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['restaurant', 'hotel', 'activity', 'transport', 'rental', 'other'] },
          title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM' },
          end_date: { type: 'string', description: '숙소 체크아웃 날짜' }, people: { type: 'number' }, confirmation: { type: 'string' },
          platform: { type: 'string' }, ref: { type: 'string' }, place_query: { type: 'string' }, note: { type: 'string' },
        },
        required: ['kind', 'title', 'date'],
      },
      run: async (a, ctx) => {
        const date = str(a.date, 10);
        if (!parseJst(date)) throw new Error('date는 YYYY-MM-DD');
        let place: SavedPlace | undefined;
        if (a.ref || a.place_query) { const p = await resolvePlace({ ref: a.ref, query: a.place_query }, ctx); if (p) place = toSaved(p); }
        const id = tripStore().upsertReservation({
          kind: (['restaurant', 'hotel', 'activity', 'transport', 'rental', 'other'].includes(String(a.kind)) ? a.kind : 'other') as ReservationKind,
          title: str(a.title, 80), date, time: /^\d{2}:\d{2}$/.test(str(a.time, 5)) ? str(a.time, 5) : undefined,
          endDate: parseJst(str(a.end_date, 10)) ? str(a.end_date, 10) : undefined, people: num(a.people),
          confirmation: str(a.confirmation, 60) || undefined, platform: str(a.platform, 40) || undefined, note: str(a.note, 300) || undefined, place,
        });
        ctx.step('예약함에 저장');
        return { ok: true, id };
      },
    },
    {
      name: 'get_weather',
      description: '현재 위치(또는 지도 중심)의 날씨와 앞으로 12시간 강수 확률, 며칠 예보를 가져와.',
      parameters: { type: 'object', properties: {} },
      run: async (_a, ctx) => {
        const c = geo().me || mapApi.center() || searchCenter();
        ctx.step('날씨 확인 중…');
        const w = await api<Omit<Weather, 'at' | 'for'>>(`/api/weather?lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}`, { signal: ctx.signal });
        runtime().set({ weather: { ...w, at: Date.now(), for: { lat: c.lat, lng: c.lng } } });
        return { now_c: w.current?.temp, feels_c: w.current?.feels, hours: w.hours?.slice(0, 12), days: w.days?.slice(0, 4) };
      },
    },
    {
      name: 'show_to_staff',
      description: '직원이나 택시 기사에게 보여줄 일본어 문장을 화면에 크게 띄워. 짧고 정중한 일본어로.',
      parameters: { type: 'object', properties: { japanese: { type: 'string' }, korean: { type: 'string' } }, required: ['japanese'] },
      run: async a => {
        const ja = str(a.japanese, 300);
        if (!ja) throw new Error('japanese가 비었어');
        ui().open({ type: 'bigtext', ja, ko: str(a.korean, 300) || undefined });
        return { ok: true, shown: true };
      },
    },
  ];
  if (settings().provider === 'gemini' && settings().webSearch) {
    tools.push({
      name: 'web_search',
      description: '최신 정보(운행 중단, 행사, 영업시간 변경, 요금)를 구글 검색으로 확인해. 꼭 필요할 때만.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (a, ctx) => {
        const q = str(a.query, 200);
        ctx.step(`웹 검색: ${q}`);
        const r = await geminiWebSearch(settings().models.gemini, q, ctx.signal);
        ctx.sources.push(...r.sources);
        return { answer: r.answer, sources: r.sources.slice(0, 5) };
      },
    });
  }
  return tools;
}

export function timeNote() {
  return fmtHM(new Date());
}
