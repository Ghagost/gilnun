/** Server configuration (server code only — never import from client components), read on every call so tests and redeploys pick up changes. */
export function serverEnv() {
  const e = process.env;
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    keys: {
      openai: e.OPENAI_API_KEY?.trim() || '',
      anthropic: e.ANTHROPIC_API_KEY?.trim() || '',
      gemini: e.GEMINI_API_KEY?.trim() || '',
    },
    accessCode: e.ACCESS_CODE?.trim() || '',
    google: {
      /** Browser key (restrict by HTTP referrer). Sent to the client by /api/config. */
      mapsKey: (e.GOOGLE_MAPS_API_KEY || e.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim(),
      mapId: (e.GOOGLE_MAPS_MAP_ID || e.NEXT_PUBLIC_GOOGLE_MAP_ID || '').trim(),
      /** Server key for Maps Grounding Lite (restrict to that API). */
      serverKey: e.GOOGLE_MAPS_SERVER_KEY?.trim() || '',
      groundingUrl: e.MAPS_GROUNDING_URL?.trim() || 'https://mapstools.googleapis.com/mcp',
    },
    rapidApiKey: e.RAPIDAPI_KEY?.trim() || '',
    navitimeBase: e.NAVITIME_BASE_URL?.trim() || 'https://navitime-route-totalnavi.p.rapidapi.com',
    upstash: { url: e.UPSTASH_REDIS_REST_URL?.trim() || e.KV_REST_API_URL?.trim() || '', token: e.UPSTASH_REDIS_REST_TOKEN?.trim() || e.KV_REST_API_TOKEN?.trim() || '' },
    bases: {
      openai: (e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      anthropic: (e.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, ''),
      gemini: (e.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      fx: (e.FX_BASE_URL || 'https://api.frankfurter.dev/v1').replace(/\/+$/, ''),
      weather: (e.WEATHER_BASE_URL || 'https://api.open-meteo.com/v1').replace(/\/+$/, ''),
      quake: (e.QUAKE_BASE_URL || 'https://api.p2pquake.net/v2').replace(/\/+$/, ''),
    },
    limits: {
      /** Requests that spend the server's AI keys, per device. */
      aiPerMinute: num(e.RATE_LIMIT_PER_MIN, 20),
      aiPerDay: num(e.RATE_LIMIT_PER_DAY, 400),
      /** Per IP (covers device-id rotation). */
      ipPerMinute: num(e.RATE_LIMIT_IP_PER_MIN, 60),
      ipPerDay: num(e.RATE_LIMIT_IP_PER_DAY, 1500),
      livePerHour: num(e.RATE_LIMIT_LIVE_PER_HOUR, 30),
      maxOutputTokens: num(e.AI_MAX_OUTPUT_TOKENS, 8000),
      maxBodyBytes: num(e.AI_MAX_BODY_BYTES, 12 * 1024 * 1024),
    },
    allowedModels: (e.AI_ALLOWED_MODELS || '').split(',').map(s => s.trim()).filter(Boolean),
    models: {
      openaiLive: e.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1',
      geminiLive: e.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live',
    },
  };
}
export type ServerEnv = ReturnType<typeof serverEnv>;
