import { serverEnv, type ServerEnv } from './env';
import { checkLimits, clientIds, safeEqual, tooMany } from './ratelimit';

export type Provider = 'openai' | 'anthropic' | 'gemini';
export const PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini'];

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const MODEL_RE: Record<Provider, RegExp> = {
  openai: /^(gpt-|o\d|chatgpt-)[a-z0-9.\-]*$/i,
  anthropic: /^claude-[a-z0-9.\-@]*$/i,
  gemini: /^gemini-[a-z0-9.\-]*$/i,
};

/** Tool types allowed on the server's own keys (cost control). */
function toolsAllowed(provider: Provider, body: Record<string, unknown>): boolean {
  const tools = body.tools;
  if (tools == null) return true;
  if (!Array.isArray(tools)) return false;
  for (const t of tools as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') return false;
    if (provider === 'openai') {
      if (t.type !== 'function' && t.type !== 'web_search') return false;
    } else if (provider === 'anthropic') {
      const ty = t.type as string | undefined;
      if (ty && ty !== 'custom' && !/^web_search_\d{8}$/.test(ty)) return false;
    } else {
      const keys = Object.keys(t);
      if (!keys.every(k => k === 'functionDeclarations' || k === 'googleSearch' || k === 'google_search')) return false;
    }
  }
  return true;
}

function capTokens(provider: Provider, body: Record<string, unknown>, max: number) {
  if (provider === 'openai') {
    const v = Number(body.max_output_tokens);
    body.max_output_tokens = Number.isFinite(v) && v > 0 ? Math.min(v, max) : max;
  } else if (provider === 'anthropic') {
    const v = Number(body.max_tokens);
    body.max_tokens = Number.isFinite(v) && v > 0 ? Math.min(v, max) : max;
  } else {
    const gc = (body.generationConfig && typeof body.generationConfig === 'object' ? body.generationConfig : {}) as Record<string, unknown>;
    const v = Number(gc.maxOutputTokens);
    gc.maxOutputTokens = Number.isFinite(v) && v > 0 ? Math.min(v, max) : max;
    body.generationConfig = gc;
  }
}

export type ResolvedKey = { key: string; mode: 'user' | 'server' } | { error: Response };

/** Picks the user's own key (BYOK) or the server key + access-code check. */
export function resolveKey(req: Request, provider: Provider, env: ServerEnv = serverEnv()): ResolvedKey {
  const user = (req.headers.get('x-user-key') || '').trim();
  if (user) {
    if (user.length < 10 || user.length > 400 || /\s/.test(user)) return { error: json(400, { error: 'bad_user_key', message: 'API 키 형식이 올바르지 않아요.' }) };
    return { key: user, mode: 'user' };
  }
  const key = env.keys[provider];
  if (!key) return { error: json(503, { error: 'no_server_key', message: '이 서버에는 이 AI의 키가 설정돼 있지 않아요. 설정에서 내 키를 넣어 주세요.' }) };
  if (env.accessCode) {
    const code = (req.headers.get('x-access-code') || '').trim();
    if (!code || !safeEqual(code, env.accessCode)) return { error: json(401, { error: 'access_code', message: '접속 코드가 필요해요. 설정에서 접속 코드를 넣어 주세요.' }) };
  }
  return { key, mode: 'server' };
}

export async function limitFor(req: Request, mode: 'user' | 'server', env: ServerEnv = serverEnv(), bucket = 'ai'): Promise<Response | null> {
  const { ip, device } = clientIds(req);
  const L = env.limits;
  const rules = mode === 'server'
    ? [
        { name: `${bucket}-dev-min`, id: device, limit: L.aiPerMinute, windowSec: 60 },
        { name: `${bucket}-dev-day`, id: device, limit: L.aiPerDay, windowSec: 86400 },
        { name: `${bucket}-ip-min`, id: ip, limit: L.ipPerMinute, windowSec: 60 },
        { name: `${bucket}-ip-day`, id: ip, limit: L.ipPerDay, windowSec: 86400 },
      ]
    : [{ name: `${bucket}-byok-ip-min`, id: ip, limit: Math.max(120, L.ipPerMinute * 2), windowSec: 60 }];
  const r = await checkLimits(rules);
  return r.ok ? null : tooMany(r.retryAfter, r.rule);
}

/** Validates and forwards one AI API call, streaming the upstream response back unchanged. */
export async function handleAiProxy(req: Request, providerRaw: string, path: string[]): Promise<Response> {
  const env = serverEnv();
  if (!PROVIDERS.includes(providerRaw as Provider)) return json(404, { error: 'unknown_provider' });
  const provider = providerRaw as Provider;

  // Allowed endpoints only.
  let upstreamPath: string;
  let model: string | undefined;
  if (provider === 'openai') {
    if (path.join('/') !== 'responses') return json(404, { error: 'unsupported_endpoint' });
    upstreamPath = '/responses';
  } else if (provider === 'anthropic') {
    if (path.join('/') !== 'messages') return json(404, { error: 'unsupported_endpoint' });
    upstreamPath = '/messages';
  } else {
    const m = path.length === 2 && path[0] === 'models' ? /^([a-z0-9.\-]+):(generateContent|streamGenerateContent)$/i.exec(path[1]) : null;
    if (!m) return json(404, { error: 'unsupported_endpoint' });
    model = m[1];
    upstreamPath = `/models/${m[1]}:${m[2]}`;
  }

  const len = Number(req.headers.get('content-length') || 0);
  if (len > env.limits.maxBodyBytes) return json(413, { error: 'too_large', message: '요청이 너무 커요. 사진 크기를 줄여 주세요.' });
  let raw: string;
  try { raw = await req.text(); } catch { return json(400, { error: 'bad_body' }); }
  if (raw.length > env.limits.maxBodyBytes) return json(413, { error: 'too_large', message: '요청이 너무 커요. 사진 크기를 줄여 주세요.' });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad_json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_json' });

  if (provider !== 'gemini') model = typeof body.model === 'string' ? body.model : undefined;
  if (!model || !MODEL_RE[provider].test(model) || model.length > 80) return json(400, { error: 'bad_model', message: '지원하지 않는 모델 이름이에요.' });

  const k = resolveKey(req, provider, env);
  if ('error' in k) return k.error;

  if (k.mode === 'server') {
    if (env.allowedModels.length && !env.allowedModels.includes(model)) return json(403, { error: 'model_not_allowed', message: `이 서버에서는 ${model} 모델을 쓸 수 없어요.` });
    if (!toolsAllowed(provider, body)) return json(400, { error: 'tool_not_allowed' });
    capTokens(provider, body, env.limits.maxOutputTokens);
  }

  const limited = await limitFor(req, k.mode, env);
  if (limited) return limited;

  const url = new URL(env.bases[provider] + upstreamPath);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'openai') headers.Authorization = `Bearer ${k.key}`;
  else if (provider === 'anthropic') { headers['x-api-key'] = k.key; headers['anthropic-version'] = '2023-06-01'; }
  else {
    headers['x-goog-api-key'] = k.key;
    const alt = new URL(req.url).searchParams.get('alt');
    if (alt === 'sse') url.searchParams.set('alt', 'sse');
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return json(499, { error: 'cancelled' });
    return json(502, { error: 'upstream_unreachable', message: 'AI 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  }
  const out = new Headers();
  out.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
  out.set('Cache-Control', 'no-store');
  out.set('X-Accel-Buffering', 'no');
  out.set('X-Gilnun-Key-Mode', k.mode);
  const ra = upstream.headers.get('retry-after');
  if (ra) out.set('Retry-After', ra);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
