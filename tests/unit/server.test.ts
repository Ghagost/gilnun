import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAiProxy } from '@/lib/server/aiProxy';
import { mintGeminiLive, mintOpenAiRealtime, sanitizeFunctions } from '@/lib/server/live';
import { buildSearchArgs, extractPlaces, handleGrounding, normalizeResult } from '@/lib/server/grounding';
import { resetMcpCaches } from '@/lib/server/mcp';
import { handleTransit, normalizeNavitime } from '@/lib/server/navitime';
import { handleConfig, normalizeQuakes, normalizeWeather } from '@/lib/server/info';
import { checkLimits, resetMemoryLimits, safeEqual } from '@/lib/server/ratelimit';
import { scriptFetch, sseResponse } from './helpers';

const ENV0 = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV0 };
  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'ACCESS_CODE', 'GOOGLE_MAPS_SERVER_KEY', 'RAPIDAPI_KEY', 'UPSTASH_REDIS_REST_URL', 'AI_ALLOWED_MODELS', 'KV_REST_API_URL']) delete process.env[k];
  resetMemoryLimits();
  resetMcpCaches();
});
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...ENV0 }; });

const req = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', 'x-device-id': 'device-aaaa1111', ...headers }, body: JSON.stringify(body) });

describe('AI proxy', () => {
  it('injects the server key, caps tokens and streams the body back', async () => {
    process.env.OPENAI_API_KEY = 'sk-server';
    const calls = scriptFetch([() => sseResponse([{ data: { type: 'response.completed' } }])]);
    const r = await handleAiProxy(req('http://app/api/ai/openai/responses', { model: 'gpt-6.1-sol', input: 'hi', max_output_tokens: 99999, tools: [{ type: 'function', name: 'x' }] }), 'openai', ['responses']);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    expect(await r.text()).toContain('response.completed');
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-server');
    expect(calls[0].body.max_output_tokens).toBe(8000);
  });

  it('uses the user key (BYOK) without needing the access code', async () => {
    process.env.ACCESS_CODE = 'secret';
    const calls = scriptFetch([() => Response.json({ ok: 1 })]);
    const r = await handleAiProxy(req('http://app/api/ai/anthropic/messages', { model: 'claude-sonnet-5-5', messages: [] }, { 'x-user-key': 'sk-ant-user-1234567' }), 'anthropic', ['messages']);
    expect(r.status).toBe(200);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-user-1234567');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(r.headers.get('x-gilnun-key-mode')).toBe('user');
  });

  it('requires the access code for server keys', async () => {
    process.env.GEMINI_API_KEY = 'g-server'; process.env.ACCESS_CODE = 'secret';
    scriptFetch([() => Response.json({}), () => Response.json({})]);
    const no = await handleAiProxy(req('http://app/api/ai/gemini/models/gemini-3.8-flash:streamGenerateContent?alt=sse', { contents: [] }), 'gemini', ['models', 'gemini-3.8-flash:streamGenerateContent']);
    expect(no.status).toBe(401);
    const ok = await handleAiProxy(req('http://app/api/ai/gemini/models/gemini-3.8-flash:streamGenerateContent?alt=sse', { contents: [] }, { 'x-access-code': 'secret' }), 'gemini', ['models', 'gemini-3.8-flash:streamGenerateContent']);
    expect(ok.status).toBe(200);
  });

  it('forwards alt=sse for Gemini and rejects unknown endpoints, models and tools', async () => {
    process.env.GEMINI_API_KEY = 'g-server'; process.env.OPENAI_API_KEY = 'sk';
    const calls = scriptFetch([() => Response.json({})]);
    await handleAiProxy(req('http://app/x?alt=sse', { contents: [] }), 'gemini', ['models', 'gemini-3.8-flash:streamGenerateContent']);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-server');
    expect((await handleAiProxy(req('http://app/x', {}), 'openai', ['files'])).status).toBe(404);
    expect((await handleAiProxy(req('http://app/x', {}), 'mistral', ['x'])).status).toBe(404);
    expect((await handleAiProxy(req('http://app/x', { model: 'dall-e-3' }), 'openai', ['responses'])).status).toBe(400);
    expect((await handleAiProxy(req('http://app/x', { model: 'gpt-6-luna', tools: [{ type: 'code_interpreter' }] }), 'openai', ['responses'])).status).toBe(400);
    expect((await handleAiProxy(req('http://app/x', { contents: [] }), 'gemini', ['models', 'gemini-3.8-flash:countTokens'])).status).toBe(404);
  });

  it('explains a missing server key and enforces the model allowlist', async () => {
    const r = await handleAiProxy(req('http://app/x', { model: 'gpt-6-luna' }), 'openai', ['responses']);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe('no_server_key');
    process.env.OPENAI_API_KEY = 'sk'; process.env.AI_ALLOWED_MODELS = 'gpt-6-luna';
    expect((await handleAiProxy(req('http://app/x', { model: 'gpt-6-astra' }), 'openai', ['responses'])).status).toBe(403);
  });

  it('rate limits per device', async () => {
    process.env.OPENAI_API_KEY = 'sk'; process.env.RATE_LIMIT_PER_MIN = '2';
    scriptFetch([() => Response.json({}), () => Response.json({})]);
    const mk = () => handleAiProxy(req('http://app/x', { model: 'gpt-6-luna' }), 'openai', ['responses']);
    expect((await mk()).status).toBe(200);
    expect((await mk()).status).toBe(200);
    const third = await mk();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('limiter falls back to memory when Upstash is down', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://up.example'; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const rule = [{ name: 'x', id: 'a', limit: 1, windowSec: 60 }];
    expect((await checkLimits(rule)).ok).toBe(true);
    expect((await checkLimits(rule)).ok).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('a', 'ab')).toBe(false);
  });
});

describe('live tokens', () => {
  it('mints an OpenAI realtime client secret with sanitized tools', async () => {
    process.env.OPENAI_API_KEY = 'sk-server';
    const calls = scriptFetch([() => Response.json({ value: 'ek_123', expires_at: 1900000000 })]);
    const r = await mintOpenAiRealtime(req('http://app/api/live/openai', { instructions: 'guide', tools: [{ name: 'set_destination', description: 'd', parameters: { type: 'object' } }, { name: 'bad name!' }], voice: 'marin' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ value: 'ek_123', model: 'gpt-realtime-2.1' });
    expect(calls[0].url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(calls[0].body.session).toMatchObject({ type: 'realtime', model: 'gpt-realtime-2.1', instructions: 'guide', audio: { output: { voice: 'marin' } } });
    expect(calls[0].body.session.tools).toEqual([{ type: 'function', name: 'set_destination', description: 'd', parameters: { type: 'object' } }]);
  });

  it('mints a single-use Gemini Live token with the model locked', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const calls = scriptFetch([() => Response.json({ name: 'auth_tokens/abc' })]);
    const r = await mintGeminiLive(req('http://app/api/live/gemini', { model: 'gemini-9-pro' }));
    expect(await r.json()).toMatchObject({ token: 'auth_tokens/abc', model: 'gemini-3.8-live' });
    const b = calls[0].body;
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1alpha/auth_tokens');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('g');
    expect(b.uses).toBe(1);
    expect(b.bidiGenerateContentSetup).toEqual({ model: 'models/gemini-3.8-live', generationConfig: { responseModalities: ['AUDIO'] } });
    expect(b.fieldMask).toBe('model,generationConfig.responseModalities');
    expect(Date.parse(b.expireTime)).toBeGreaterThan(Date.parse(b.newSessionExpireTime));
  });

  it('lets a user key pick its own live model', async () => {
    delete process.env.GEMINI_API_KEY;
    const calls = scriptFetch([() => Response.json({ name: 'auth_tokens/u' })]);
    const r = await mintGeminiLive(req('http://app/api/live/gemini', { model: 'gemini-3.9-live' }, { 'x-user-key': 'AIzaUser-key-123' }));
    expect(await r.json()).toMatchObject({ model: 'gemini-3.9-live' });
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaUser-key-123');
  });

  it('drops anything that is not a plain function declaration', () => {
    expect(sanitizeFunctions([{ name: 'ok_1' }, { codeExecution: {} }, 'x', { name: '1bad' }])).toEqual([{ name: 'ok_1', description: undefined, parameters: undefined }]);
  });
});

describe('Maps Grounding Lite', () => {
  const schema = { type: 'object', properties: { text_query: { type: 'string' }, location_bias: { type: 'object', properties: { circle: { type: 'object', properties: { center: { type: 'object', properties: { latitude: {}, longitude: {} } }, radius_meters: {} } } } }, language_code: {}, region_code: {} } };

  it('adapts arguments to the advertised schema', () => {
    expect(buildSearchArgs(schema as any, { query: 'ラーメン', lat: 35.69, lng: 139.7, radius: 800, language: 'ko', region: 'JP' })).toEqual({
      text_query: 'ラーメン', language_code: 'ko', region_code: 'JP', location_bias: { circle: { center: { latitude: 35.69, longitude: 139.7 }, radius_meters: 800 } },
    });
    expect(buildSearchArgs({ properties: { query: {}, location: { properties: { lat: {}, lng: {} } }, radius_meters: {} } } as any, { query: 'x', lat: 1, lng: 2 }))
      .toEqual({ query: 'x', location: { lat: 1, lng: 2 }, radius_meters: 1500 });
    expect(buildSearchArgs(undefined, { query: 'x' })).toEqual({ text_query: 'x' });
  });

  it('extracts places from nested JSON', () => {
    const data = { places: [
      { place: 'places/ChIJ1234567890', id: 'ChIJ1234567890', displayName: { text: '一蘭 新宿' }, location: { latitude: 35.69, longitude: 139.70 }, googleMapsUri: 'https://maps.google.com/?cid=1', summary: '24시간 라멘' },
      { name: 'No coords', googleMapsUri: 'https://www.google.com/maps/place/x' },
      { name: 'junk' },
    ] };
    const ps = extractPlaces(data);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toEqual({ placeId: 'ChIJ1234567890', name: '一蘭 新宿', lat: 35.69, lng: 139.7, mapsUri: 'https://maps.google.com/?cid=1', summary: '24시간 라멘' });
    const n = normalizeResult({ content: [{ type: 'text', text: JSON.stringify(data) }] });
    expect(n.sources[0]).toEqual({ title: '一蘭 新宿', url: 'https://maps.google.com/?cid=1' });
  });

  it('runs initialize → tools/list → tools/call over SSE with a session id', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'gk';
    const sse = (msg: unknown, sid?: string) => new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { headers: { 'content-type': 'text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) } });
    const calls = scriptFetch([
      r => sse({ jsonrpc: '2.0', id: r.body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, 'S1'),
      () => new Response(null, { status: 202 }),
      r => sse({ jsonrpc: '2.0', id: r.body.id, result: { tools: [{ name: 'search_places', inputSchema: schema }] } }),
      r => sse({ jsonrpc: '2.0', id: r.body.id, result: { content: [{ type: 'text', text: JSON.stringify({ places: [{ id: 'ChIJabcdefghij', displayName: 'A', location: { latitude: 1, longitude: 2 } }] }) }] } }),
    ]);
    const r = await handleGrounding(req('http://app/api/maps/grounding', { query: '라멘', lat: 35.6, lng: 139.7 }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.places[0]).toMatchObject({ placeId: 'ChIJabcdefghij', name: 'A', lat: 1, lng: 2 });
    expect(calls[0].body.method).toBe('initialize');
    expect(calls[1].body.method).toBe('notifications/initialized');
    expect((calls[2].init.headers as Record<string, string>)['Mcp-Session-Id']).toBe('S1');
    expect((calls[2].init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('gk');
    expect(calls[3].body.params).toEqual({ name: 'search_places', arguments: { text_query: '라멘', language_code: 'ko', region_code: 'JP', location_bias: { circle: { center: { latitude: 35.6, longitude: 139.7 }, radius_meters: 1500 } } } });
  });

  it('retries with the query only when the tool rejects the arguments', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'gk';
    const calls = scriptFetch([
      r => Response.json({ jsonrpc: '2.0', id: r.body.id, result: {} }),
      () => new Response(null, { status: 202 }),
      r => Response.json({ jsonrpc: '2.0', id: r.body.id, error: { code: -32601, message: 'no list' } }),
      r => Response.json({ jsonrpc: '2.0', id: r.body.id, result: { isError: true, content: [{ type: 'text', text: 'bad location_bias' }] } }),
      r => Response.json({ jsonrpc: '2.0', id: r.body.id, result: { content: [{ type: 'text', text: '추천: 一蘭' }] } }),
    ]);
    const j = await (await handleGrounding(req('http://app/api/maps/grounding', { query: '라멘', lat: 35.6, lng: 139.7 }))).json();
    expect(calls[4].body.params.arguments).toEqual({ text_query: '라멘' });
    expect(j).toEqual({ text: '추천: 一蘭', places: [], sources: [] });
  });

  it('is off without a server key', async () => {
    expect((await handleGrounding(req('http://app/x', { query: 'a' }))).status).toBe(501);
  });
});

describe('NAVITIME transit', () => {
  const sample = {
    items: [{
      summary: { move: { time: 27, transit_count: 1, fare: { unit_0: 260, unit_48: 252 }, from_time: '2026-11-23T10:00:00+09:00', to_time: '2026-11-23T10:27:00+09:00', distance: 9000 } },
      sections: [
        { type: 'point', name: 'start' },
        { type: 'move', move: 'walk', time: 5, distance: 300, line_name: '徒歩' },
        { type: 'point', name: '新宿', gateway: '東口', start_platform: '14番線', numbering: { departure: [{ symbol: 'JY', number: '17' }] } },
        { type: 'move', move: 'local_train', time: 10, distance: 6000, line_name: 'ＪＲ山手線内回り', from_time: '2026-11-23T10:05:00+09:00', to_time: '2026-11-23T10:15:00+09:00', transport: { name: 'ＪＲ山手線', color: '#9ACD32', company: { name: 'JR東日本' }, links: [{ destination: { name: '渋谷・品川方面' } }] } },
        { type: 'point', name: '渋谷', goal_platform: '2番線', gateway: 'ハチ公口' },
        { type: 'move', move: 'walk', time: 0, distance: 0 },
        { type: 'point', name: 'goal' },
      ],
      shapes: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[139.70, 35.69], [139.70, 35.66]] } }] },
    }],
  };
  it('normalizes routes with fares, platforms, exits and numbering', () => {
    const [r] = normalizeNavitime(sample);
    expect(r).toMatchObject({ minutes: 27, transfers: 1, fareIc: 252, fareTicket: 260, departure: '10:00', arrival: '10:27' });
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0]).toMatchObject({ kind: 'walk', from: 'start', to: '新宿', minutes: 5 });
    expect(r.legs[1]).toMatchObject({ kind: 'train', line: 'ＪＲ山手線', color: '#9ACD32', company: 'JR東日本', direction: '渋谷・品川方面', from: '新宿', to: '渋谷', fromTime: '10:05', toTime: '10:15', platformFrom: '14番線', platformTo: '2番線', exitTo: 'ハチ公口', numberingFrom: 'JY17' });
    expect(r.path).toEqual([{ lat: 35.69, lng: 139.7 }, { lat: 35.66, lng: 139.7 }]);
  });
  it('proxies with the RapidAPI key and validates input', async () => {
    process.env.RAPIDAPI_KEY = 'rk';
    const calls = scriptFetch([() => Response.json(sample)]);
    const r = await handleTransit(new Request('http://app/api/transit?from=35.69,139.70&to=35.66,139.70&at=2026-11-23T10:00&type=last', { headers: { 'x-device-id': 'device-aaaa1111' } }));
    expect(r.status).toBe(200);
    expect((await r.json()).routes).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/route_transit');
    expect(u.searchParams.get('last_operation')).toBe('2026-11-23T10:00:00');
    expect((calls[0].init.headers as Record<string, string>)['x-rapidapi-host']).toBe('navitime-route-totalnavi.p.rapidapi.com');
    expect((await handleTransit(new Request('http://app/api/transit?from=abc&to=1,2&at=2026-11-23T10:00'))).status).toBe(400);
  });
});

describe('info endpoints', () => {
  it('reports configuration without leaking secrets', async () => {
    process.env.OPENAI_API_KEY = 'sk-secret'; process.env.GOOGLE_MAPS_API_KEY = 'AIzaBrowser'; process.env.ACCESS_CODE = 'c';
    const j = await handleConfig().json();
    expect(j).toMatchObject({ ai: { openai: true, anthropic: false, gemini: false }, accessCodeRequired: true, google: { mapsKey: 'AIzaBrowser', grounding: false }, transit: false });
    expect(JSON.stringify(j)).not.toContain('sk-secret');
  });
  it('normalizes weather and quakes', () => {
    const w = normalizeWeather({
      current: { time: '2026-11-23T10:15', temperature_2m: 14.2, weather_code: 61, precipitation: 0.4 },
      hourly: { time: ['2026-11-23T09:00', '2026-11-23T10:00', '2026-11-23T11:00'], temperature_2m: [13, 14, 15], precipitation_probability: [10, 60, 80], weather_code: [3, 61, 63] },
      daily: { time: ['2026-11-23'], weather_code: [61], temperature_2m_max: [16], temperature_2m_min: [9], precipitation_probability_max: [80] },
    }) as any;
    expect(w.hours[0]).toEqual({ time: '10:00', temp: 14, pop: 60, code: 61 });
    expect(w.days[0]).toMatchObject({ date: '2026-11-23', max: 16 });
    const q = normalizeQuakes([{ id: 'q1', code: 551, time: '2026/11/23 10:01:02.000', earthquake: { time: '2026/11/23 10:00:00', hypocenter: { name: '千葉県北西部', latitude: 35.7, longitude: 140.1, depth: 60, magnitude: 4.8 }, maxScale: 45, domesticTsunami: 'None' } }, { code: 552 }]) as any[];
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ place: '千葉県北西部', scaleText: '5약', magnitude: 4.8, time: '2026-11-23T10:00:00+09:00', tsunami: 'None' });
  });
});
