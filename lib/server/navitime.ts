import type { TransitLeg, TransitRoute } from '../types';
import { serverEnv } from './env';
import { checkLimits, clientIds, safeEqual, tooMany } from './ratelimit';

type Obj = Record<string, unknown>;
const json = (status: number, body: unknown, cache = 'no-store') => Response.json(body, { status, headers: { 'Cache-Control': cache } });

function hm(iso: unknown): string | undefined {
  if (typeof iso !== 'string') return undefined;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : undefined;
}
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

function kindOf(move: unknown, line: string): TransitLeg['kind'] {
  switch (move) {
    case 'walk': return 'walk';
    case 'superexpress_train': return 'shinkansen';
    case 'ultraexpress_train': case 'express_train': case 'rapid_train': case 'semiexpress_train': case 'local_train':
      return /地下鉄|メトロ|Metro|都営|市営/.test(line) ? 'subway' : 'train';
    case 'local_bus': case 'highway_bus': case 'shuttle_bus': return 'bus';
    case 'domestic_flight': return 'flight';
    case 'ferry': return 'ferry';
    default: return 'other';
  }
}

function numbering(p: Obj | undefined, which: 'departure' | 'arrival'): string | undefined {
  const nb = p?.numbering as Obj | undefined;
  const arr = nb?.[which] as Obj[] | undefined;
  const first = Array.isArray(arr) ? arr[0] : undefined;
  if (!first) return undefined;
  const s = `${first.symbol ?? ''}${first.number ?? ''}`.trim();
  return s || undefined;
}

function collectPath(shapes: unknown): { lat: number; lng: number }[] | undefined {
  const fc = shapes as Obj | undefined;
  const feats = fc?.features as Obj[] | undefined;
  if (!Array.isArray(feats)) return undefined;
  const pts: { lat: number; lng: number }[] = [];
  for (const f of feats) {
    const g = f?.geometry as Obj | undefined;
    const coords = g?.coordinates as unknown;
    const push = (c: unknown) => { if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') pts.push({ lng: c[0], lat: c[1] }); };
    if (g?.type === 'LineString' && Array.isArray(coords)) (coords as unknown[]).forEach(push);
    else if (g?.type === 'MultiLineString' && Array.isArray(coords)) (coords as unknown[][]).forEach(line => line.forEach(push));
  }
  if (pts.length < 2) return undefined;
  // Thin very long paths for the client.
  if (pts.length > 1500) { const step = Math.ceil(pts.length / 1500); return pts.filter((_, i) => i % step === 0 || i === pts.length - 1); }
  return pts;
}

export function normalizeNavitime(data: unknown): TransitRoute[] {
  const items = (data as Obj)?.items as Obj[] | undefined;
  if (!Array.isArray(items)) return [];
  const routes: TransitRoute[] = [];
  for (const it of items) {
    const sum = (it.summary as Obj | undefined)?.move as Obj | undefined;
    const sections = Array.isArray(it.sections) ? (it.sections as Obj[]) : [];
    const legs: TransitLeg[] = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s?.type !== 'move') continue;
      const prev = sections.slice(0, i).reverse().find(x => x?.type === 'point');
      const next = sections.slice(i + 1).find(x => x?.type === 'point');
      const line = String(s.line_name ?? '');
      const kind = kindOf(s.move, line);
      const tr = (s.transport || {}) as Obj;
      const links = Array.isArray(tr.links) ? (tr.links as Obj[]) : [];
      const dest = (links[0]?.destination as Obj | undefined)?.name;
      const leg: TransitLeg = {
        kind,
        line: kind === 'walk' ? undefined : (String(tr.name ?? '') || line || undefined),
        color: typeof tr.color === 'string' ? tr.color : undefined,
        company: ((tr.company as Obj | undefined)?.name as string) || undefined,
        direction: typeof dest === 'string' ? dest : (typeof links[0]?.direction === 'string' ? (links[0].direction as string) : undefined),
        from: String(prev?.name ?? ''),
        to: String(next?.name ?? ''),
        fromTime: hm(s.from_time),
        toTime: hm(s.to_time),
        minutes: n(s.time) ?? 0,
        distance: n(s.distance),
        platformFrom: typeof prev?.start_platform === 'string' ? prev.start_platform : undefined,
        platformTo: typeof next?.goal_platform === 'string' ? next.goal_platform : undefined,
        exitTo: kind === 'walk'
          ? (typeof prev?.gateway === 'string' ? prev.gateway : undefined)
          : (typeof next?.gateway === 'string' ? next.gateway : undefined),
        numberingFrom: numbering(prev, 'departure'),
        numberingTo: numbering(next, 'arrival'),
      };
      if (kind === 'walk' && (leg.minutes || 0) === 0 && (leg.distance || 0) === 0) continue;
      legs.push(leg);
    }
    const fare = (sum?.fare || {}) as Obj;
    const path = collectPath(it.shapes) || collectPath((data as Obj)?.shapes);
    routes.push({
      minutes: n(sum?.time) ?? legs.reduce((a, l) => a + (l.minutes || 0), 0),
      departure: hm(sum?.from_time),
      arrival: hm(sum?.to_time),
      transfers: n(sum?.transit_count) ?? Math.max(0, legs.filter(l => l.kind !== 'walk').length - 1),
      fareIc: n(fare.unit_48),
      fareTicket: n(fare.unit_0),
      distance: n(sum?.distance),
      legs,
      path,
    });
  }
  return routes;
}

const LL = /^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** GET /api/transit?from=lat,lng&to=lat,lng&at=YYYY-MM-DDTHH:MM&type=depart|arrive|first|last */
export async function handleTransit(req: Request): Promise<Response> {
  const env = serverEnv();
  if (!env.rapidApiKey) return json(501, { error: 'not_configured' });
  if (env.accessCode) {
    const code = (req.headers.get('x-access-code') || '').trim();
    if (!code || !safeEqual(code, env.accessCode)) return json(401, { error: 'access_code', message: '접속 코드가 필요해요.' });
  }
  const u = new URL(req.url);
  const from = u.searchParams.get('from') || '', to = u.searchParams.get('to') || '';
  if (!LL.test(from) || !LL.test(to)) return json(400, { error: 'bad_coords' });
  const type = u.searchParams.get('type') || 'depart';
  let at = u.searchParams.get('at') || '';
  if (!DT.test(at)) return json(400, { error: 'bad_time' });
  if (at.length === 16) at += ':00';

  const { ip, device } = clientIds(req);
  const lim = await checkLimits([
    { name: 'tr-dev-min', id: device, limit: env.limits.aiPerMinute, windowSec: 60 },
    { name: 'tr-ip-day', id: ip, limit: env.limits.ipPerDay, windowSec: 86400 },
  ]);
  if (!lim.ok) return tooMany(lim.retryAfter, lim.rule);

  const q = new URL(env.navitimeBase.replace(/\/+$/, '') + '/route_transit');
  q.searchParams.set('start', from);
  q.searchParams.set('goal', to);
  const key = type === 'arrive' ? 'goal_time' : type === 'first' ? 'first_operation' : type === 'last' ? 'last_operation' : 'start_time';
  q.searchParams.set(key, at);
  q.searchParams.set('limit', '5');
  q.searchParams.set('shape', 'true');
  let r: Response;
  try {
    r = await fetch(q, {
      headers: { 'x-rapidapi-key': env.rapidApiKey, 'x-rapidapi-host': new URL(env.navitimeBase).host },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: '경로 서버에 연결하지 못했어요.' });
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) return json(r.status === 429 ? 429 : 502, { error: 'upstream_error', status: r.status, message: (data as Obj)?.message || `경로 검색 오류 (${r.status})` });
  return json(200, { routes: normalizeNavitime(data), provider: 'NAVITIME' }, 'private, max-age=60');
}
