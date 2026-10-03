import { serverEnv } from './env';
import { mcpCallTool, mcpListTools, type McpCallResult, type McpTool } from './mcp';
import { checkLimits, clientIds, safeEqual, tooMany } from './ratelimit';

export type GroundedPlace = { placeId?: string; name: string; lat?: number; lng?: number; mapsUri?: string; summary?: string };
export type GroundingResult = { text: string; places: GroundedPlace[]; sources: { title: string; url: string }[] };

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[] } & Record<string, unknown>;

const pick = (props: Record<string, unknown> | undefined, keys: string[]) => keys.find(k => props && k in props);

function latLngShape(schema: Schema | undefined, lat: number, lng: number): Record<string, number> {
  const p = schema?.properties;
  if (p && ('lat' in p || 'lng' in p)) return { lat, lng };
  return { latitude: lat, longitude: lng };
}

/** Builds search_places arguments that match whatever input schema the server advertises. */
export function buildSearchArgs(schema: Schema | undefined, q: { query: string; lat?: number; lng?: number; radius?: number; language?: string; region?: string }): Record<string, unknown> {
  const props = schema?.properties || {};
  const args: Record<string, unknown> = {};
  args[pick(props, ['text_query', 'textQuery', 'query']) || 'text_query'] = q.query;
  const langKey = pick(props, ['language_code', 'languageCode']);
  if (langKey && q.language) args[langKey] = q.language;
  const regionKey = pick(props, ['region_code', 'regionCode']);
  if (regionKey && q.region) args[regionKey] = q.region;
  if (typeof q.lat === 'number' && typeof q.lng === 'number') {
    const radius = Math.round(Math.min(50000, Math.max(100, q.radius || 1500)));
    const lbKey = pick(props, ['location_bias', 'locationBias']);
    if (lbKey) {
      const lb = props[lbKey] as Schema | undefined;
      const lbp = lb?.properties;
      const rKey = (s?: Record<string, unknown>) => pick(s, ['radius_meters', 'radiusMeters', 'radius']) || 'radius_meters';
      if (lbp && 'circle' in lbp) {
        const c = lbp.circle as Schema;
        args[lbKey] = { circle: { center: latLngShape(c.properties?.center as Schema, q.lat, q.lng), [rKey(c.properties)]: radius } };
      } else if (lbp && 'center' in lbp) {
        args[lbKey] = { center: latLngShape(lbp.center as Schema, q.lat, q.lng), [rKey(lbp)]: radius };
      } else if (lbp && ('latitude' in lbp || 'lat' in lbp)) {
        args[lbKey] = { ...latLngShape(lb, q.lat, q.lng), [rKey(lbp)]: radius };
      } else {
        args[lbKey] = { circle: { center: { latitude: q.lat, longitude: q.lng }, radius_meters: radius } };
      }
    } else if ('location' in props) {
      args.location = latLngShape(props.location as Schema, q.lat, q.lng);
      const rk = pick(props, ['radius_meters', 'radiusMeters', 'radius']);
      if (rk) args[rk] = radius;
    }
  }
  return args;
}

function asText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string') return (v as { text: string }).text;
  return undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Walks any JSON shape and collects place-like objects. */
export function extractPlaces(data: unknown, limit = 12): GroundedPlace[] {
  const out: GroundedPlace[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 8 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    const name = asText(o.displayName) || asText(o.display_name) || asText(o.name) || asText(o.title);
    const rawId = (o.placeId || o.place_id || o.id) as unknown;
    let placeId = typeof rawId === 'string' ? rawId.replace(/^places\//, '') : undefined;
    if (placeId && !/^[A-Za-z0-9_-]{10,}$/.test(placeId)) placeId = undefined;
    const loc = (o.location || o.latLng || o.lat_lng || o.coordinates) as Record<string, unknown> | undefined;
    const lat = num(loc?.latitude ?? loc?.lat ?? o.latitude ?? o.lat);
    const lng = num(loc?.longitude ?? loc?.lng ?? o.longitude ?? o.lng);
    const mapsUri = [o.googleMapsUri, o.google_maps_uri, o.googleMapsURI, o.mapsUri, o.maps_uri, o.uri, o.url].find(u => typeof u === 'string' && /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl)/.test(u)) as string | undefined;
    if (name && (placeId || mapsUri || (lat !== undefined && lng !== undefined))) {
      const key = placeId || mapsUri || `${name}@${lat},${lng}`;
      if (!seen.has(key)) {
        seen.add(key);
        const summary = asText(o.summary) || asText(o.placeSummary) || asText(o.generativeSummary) || asText(o.editorialSummary);
        out.push({ placeId, name: name.slice(0, 120), lat, lng, mapsUri, summary: summary?.slice(0, 400) });
      }
    }
    for (const [k, x] of Object.entries(o)) {
      if (k === 'location') continue;
      if (x && typeof x === 'object') visit(x, depth + 1);
    }
  };
  visit(data, 0);
  return out;
}

export function normalizeResult(res: McpCallResult): GroundingResult {
  const texts = (res.content || []).filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text as string);
  let data: unknown = res.structuredContent;
  if (!data) {
    for (const t of texts) {
      const s = t.trim();
      if (s.startsWith('{') || s.startsWith('[')) { try { data = JSON.parse(s); break; } catch { /* plain text */ } }
    }
  }
  const places = data ? extractPlaces(data) : [];
  const sources: { title: string; url: string }[] = [];
  for (const p of places) if (p.mapsUri) sources.push({ title: p.name, url: p.mapsUri });
  // Text for the model: prefer the server's own text (grounded output), capped.
  let text = texts.join('\n').trim();
  if (!text && data) text = JSON.stringify(data);
  return { text: text.slice(0, 8000), places, sources };
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function findTool(tools: McpTool[], name: string): McpTool | undefined {
  return tools.find(t => t.name === name) || tools.find(t => t.name.endsWith(name));
}

/** POST /api/maps/grounding  { query, lat?, lng?, radius?, language? } */
export async function handleGrounding(req: Request): Promise<Response> {
  const env = serverEnv();
  if (!env.google.serverKey) return json(501, { error: 'not_configured' });
  if (env.accessCode) {
    const code = (req.headers.get('x-access-code') || '').trim();
    if (!code || !safeEqual(code, env.accessCode)) return json(401, { error: 'access_code', message: '접속 코드가 필요해요.' });
  }
  const { ip, device } = clientIds(req);
  const lim = await checkLimits([
    { name: 'gr-dev-min', id: device, limit: env.limits.aiPerMinute, windowSec: 60 },
    { name: 'gr-ip-day', id: ip, limit: env.limits.ipPerDay, windowSec: 86400 },
  ]);
  if (!lim.ok) return tooMany(lim.retryAfter, lim.rule);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 300) : '';
  if (!query) return json(400, { error: 'missing_query' });
  const lat = num(body.lat), lng = num(body.lng);
  const radius = num(body.radius);
  const language = typeof body.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.language) ? body.language : 'ko';

  const url = env.google.groundingUrl, key = env.google.serverKey;
  try {
    let schema: Schema | undefined;
    let toolName = 'search_places';
    try {
      const t = findTool(await mcpListTools(url, key), 'search_places');
      if (t) { toolName = t.name; schema = t.inputSchema as Schema; }
    } catch { /* fall back to documented argument names */ }
    let res: McpCallResult | null = null;
    try {
      res = await mcpCallTool(url, key, toolName, buildSearchArgs(schema, { query, lat, lng, radius, language, region: 'JP' }));
      if (res?.isError) res = null;
    } catch { res = null; }
    if (!res) {
      // Retry with the query alone: the most portable argument set.
      res = await mcpCallTool(url, key, toolName, buildSearchArgs(schema, { query }));
      if (res?.isError) {
        const msg = (res.content || []).map(c => c.text).join(' ').slice(0, 200);
        return json(502, { error: 'tool_error', message: msg || '구글 지도 그라운딩 오류' });
      }
    }
    return json(200, normalizeResult(res));
  } catch (e) {
    return json(502, { error: 'grounding_failed', message: (e as Error).message?.slice(0, 200) || 'failed' });
  }
}
