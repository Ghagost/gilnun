import { serverEnv } from './env';
import { checkLimits, clientIds, tooMany } from './ratelimit';

const json = (status: number, body: unknown, cache = 'no-store') => Response.json(body, { status, headers: { 'Cache-Control': cache } });
type Obj = Record<string, unknown>;

/* ---------------- /api/config ---------------- */
export function handleConfig(): Response {
  const env = serverEnv();
  return json(200, {
    ai: { openai: !!env.keys.openai, anthropic: !!env.keys.anthropic, gemini: !!env.keys.gemini },
    accessCodeRequired: !!env.accessCode,
    google: { mapsKey: env.google.mapsKey || null, mapId: env.google.mapId || null, grounding: !!env.google.serverKey },
    transit: !!env.rapidApiKey,
    limits: { perMinute: env.limits.aiPerMinute, perDay: env.limits.aiPerDay },
    models: { openaiLive: env.models.openaiLive, geminiLive: env.models.geminiLive },
    version: '2.0.0',
  }, 'no-store');
}

/* ---------------- /api/fx ---------------- */
let fxCache: { at: number; body: Obj } | null = null;
export async function handleFx(): Promise<Response> {
  if (fxCache && Date.now() - fxCache.at < 6 * 3600e3) return json(200, fxCache.body, 'public, s-maxage=3600, max-age=600');
  const env = serverEnv();
  const tries: [string, (j: Obj) => Obj | null][] = [
    [`${env.bases.fx}/latest?base=JPY&symbols=KRW`, j => {
      const r = (j.rates as Obj | undefined)?.KRW;
      return typeof r === 'number' ? { rate: r, date: String(j.date || ''), source: 'Frankfurter (ECB)' } : null;
    }],
    ['https://open.er-api.com/v6/latest/JPY', j => {
      const r = (j.rates as Obj | undefined)?.KRW;
      return typeof r === 'number' ? { rate: r, date: String(j.time_last_update_utc || '').slice(5, 16), source: 'ExchangeRate-API' } : null;
    }],
  ];
  for (const [url, parse] of tries) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const body = parse(await r.json());
      if (body) { fxCache = { at: Date.now(), body }; return json(200, body, 'public, s-maxage=3600, max-age=600'); }
    } catch { /* next */ }
  }
  if (fxCache) return json(200, { ...fxCache.body, stale: true }, 'no-store');
  return json(502, { error: 'fx_unavailable' });
}

/* ---------------- /api/weather ---------------- */
const wxCache = new Map<string, { at: number; body: Obj }>();
export function normalizeWeather(j: Obj): Obj {
  const cur = (j.current || {}) as Obj;
  const hourly = (j.hourly || {}) as Obj;
  const daily = (j.daily || {}) as Obj;
  const ht = (hourly.time as string[]) || [];
  const curTime = String(cur.time || '');
  let start = ht.findIndex(t => t >= curTime.slice(0, 13));
  if (start < 0) start = 0;
  const hours = ht.slice(start, start + 12).map((t, k) => {
    const i = start + k;
    return { time: t.slice(11, 16), temp: (hourly.temperature_2m as number[])?.[i], pop: (hourly.precipitation_probability as number[])?.[i], code: (hourly.weather_code as number[])?.[i] };
  });
  const days = ((daily.time as string[]) || []).map((d, i) => ({
    date: d, code: (daily.weather_code as number[])?.[i], max: (daily.temperature_2m_max as number[])?.[i], min: (daily.temperature_2m_min as number[])?.[i], pop: (daily.precipitation_probability_max as number[])?.[i],
  }));
  return {
    current: { time: curTime, temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, precip: cur.precipitation, wind: cur.wind_speed_10m, humidity: cur.relative_humidity_2m },
    hours, days,
  };
}
export async function handleWeather(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json(400, { error: 'bad_coords' });
  const { ip } = clientIds(req);
  const lim = await checkLimits([{ name: 'wx-ip-min', id: ip, limit: 30, windowSec: 60 }]);
  if (!lim.ok) return tooMany(lim.retryAfter, lim.rule);
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const c = wxCache.get(key);
  if (c && Date.now() - c.at < 10 * 60000) return json(200, c.body, 'public, max-age=300');
  const env = serverEnv();
  const q = new URL(`${env.bases.weather}/forecast`);
  q.searchParams.set('latitude', lat.toFixed(3));
  q.searchParams.set('longitude', lng.toFixed(3));
  q.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
  q.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code');
  q.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  q.searchParams.set('timezone', 'Asia/Tokyo');
  q.searchParams.set('forecast_days', '4');
  try {
    const r = await fetch(q, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return json(502, { error: 'weather_upstream', status: r.status });
    const body = normalizeWeather(await r.json());
    if (wxCache.size > 500) wxCache.clear();
    wxCache.set(key, { at: Date.now(), body });
    return json(200, body, 'public, max-age=300');
  } catch {
    if (c) return json(200, { ...c.body, stale: true });
    return json(502, { error: 'weather_unavailable' });
  }
}

/* ---------------- /api/quake ---------------- */
const SCALE: Record<number, string> = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5약', 50: '5강', 55: '6약', 60: '6강', 70: '7' };
let qCache: { at: number; body: Obj } | null = null;
export function normalizeQuakes(arr: unknown): Obj[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x && (x as Obj).code === 551).map(x => {
    const o = x as Obj;
    const eq = (o.earthquake || {}) as Obj;
    const hc = (eq.hypocenter || {}) as Obj;
    const t = String(eq.time || o.time || '');
    const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/.exec(t);
    const iso = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00` : null;
    const maxScale = Number(eq.maxScale);
    return {
      id: String(o.id || ''),
      time: iso,
      place: String(hc.name || ''),
      lat: Number.isFinite(Number(hc.latitude)) && Number(hc.latitude) > -200 ? Number(hc.latitude) : null,
      lng: Number.isFinite(Number(hc.longitude)) && Number(hc.longitude) > -200 ? Number(hc.longitude) : null,
      depth: Number.isFinite(Number(hc.depth)) && Number(hc.depth) >= 0 ? Number(hc.depth) : null,
      magnitude: Number.isFinite(Number(hc.magnitude)) && Number(hc.magnitude) >= 0 ? Number(hc.magnitude) : null,
      maxScale: Number.isFinite(maxScale) ? maxScale : -1,
      scaleText: SCALE[maxScale] || '정보 없음',
      tsunami: String(eq.domesticTsunami || 'Unknown'),
    };
  }).filter(q => q.time);
}
export async function handleQuake(): Promise<Response> {
  if (qCache && Date.now() - qCache.at < 30000) return json(200, qCache.body, 'public, max-age=20');
  const env = serverEnv();
  try {
    const r = await fetch(`${env.bases.quake}/history?codes=551&limit=12`, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const body = { quakes: normalizeQuakes(await r.json()), at: new Date().toISOString() };
    qCache = { at: Date.now(), body };
    return json(200, body, 'public, max-age=20');
  } catch {
    if (qCache) return json(200, { ...qCache.body, stale: true });
    return json(502, { error: 'quake_unavailable' });
  }
}
