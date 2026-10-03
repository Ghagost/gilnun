import { serverEnv } from './env';
import { checkLimits, clientIds, tooMany } from './ratelimit';
import { resolveKey } from './aiProxy';

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

type FnDecl = { name: string; description?: string; parameters?: Record<string, unknown> };

/** Keeps only plain function declarations with sane sizes (no code execution or other built-in tools). */
export function sanitizeFunctions(input: unknown): FnDecl[] {
  if (!Array.isArray(input)) return [];
  const out: FnDecl[] = [];
  for (const f of input.slice(0, 16)) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    if (typeof o.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(o.name)) continue;
    const params = o.parameters && typeof o.parameters === 'object' ? (o.parameters as Record<string, unknown>) : undefined;
    if (params && JSON.stringify(params).length > 4000) continue;
    out.push({ name: o.name, description: typeof o.description === 'string' ? o.description.slice(0, 1000) : undefined, parameters: params });
  }
  return out;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

async function liveLimit(req: Request, mode: 'user' | 'server'): Promise<Response | null> {
  const env = serverEnv();
  const { ip, device } = clientIds(req);
  const rules = mode === 'server'
    ? [{ name: 'live-dev-hour', id: device, limit: env.limits.livePerHour, windowSec: 3600 }, { name: 'live-ip-hour', id: ip, limit: env.limits.livePerHour * 3, windowSec: 3600 }]
    : [{ name: 'live-byok-ip-min', id: ip, limit: 30, windowSec: 60 }];
  const r = await checkLimits(rules);
  return r.ok ? null : tooMany(r.retryAfter, r.rule);
}

/** With the operator's key only the configured live model is used; with the user's own key any valid name is accepted. */
function liveModel(requested: string, pattern: RegExp, mode: 'user' | 'server', fallback: string): string {
  return mode === 'user' && pattern.test(requested) ? requested : fallback;
}

/** Mints a short-lived OpenAI Realtime client secret (WebRTC). */
export async function mintOpenAiRealtime(req: Request): Promise<Response> {
  const env = serverEnv();
  const k = resolveKey(req, 'openai', env);
  if ('error' in k) return k.error;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limited = await liveLimit(req, k.mode);
  if (limited) return limited;
  const model = liveModel(str(body.model, 60), /^gpt-[a-z0-9.\-]+$/i, k.mode, env.models.openaiLive);
  const voice = /^[a-z]{2,20}$/.test(str(body.voice, 20)) ? str(body.voice, 20) : 'marin';
  const tools = sanitizeFunctions(body.tools).map(t => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }));
  const session: Record<string, unknown> = {
    type: 'realtime',
    model,
    instructions: str(body.instructions, 12000) || undefined,
    audio: { output: { voice } },
  };
  if (tools.length) { session.tools = tools; session.tool_choice = 'auto'; }
  let r: Response;
  try {
    r = await fetch(`${env.bases.openai}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: 'OpenAI에 연결하지 못했어요.' });
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) return json(r.status, { error: 'upstream_error', message: (j.error as { message?: string })?.message || `OpenAI 오류 (${r.status})` });
  const value = (j.value as string) || ((j.client_secret as { value?: string })?.value) || '';
  if (!value) return json(502, { error: 'no_secret', message: 'OpenAI가 임시 키를 돌려주지 않았어요.' });
  return json(200, { value, expiresAt: j.expires_at ?? null, model });
}

/** Ephemeral tokens are minted on v1alpha; the Live WebSocket itself is v1beta. */
export function geminiTokenUrl(base: string): string {
  return `${base.replace(/\/v1beta$/, '/v1alpha')}/auth_tokens`;
}

/**
 * Mints a single-use Gemini Live token. The model and the audio-only output are locked into the token
 * (REST shape of the SDK's `liveConnectConstraints` + `lockAdditionalFields: []`), so a leaked token can't
 * switch to another model. The browser sends the system prompt, tools and resumption handle in its own
 * setup message, which is what the constrained endpoint honours.
 */
export async function mintGeminiLive(req: Request): Promise<Response> {
  const env = serverEnv();
  const k = resolveKey(req, 'gemini', env);
  if ('error' in k) return k.error;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limited = await liveLimit(req, k.mode);
  if (limited) return limited;
  const model = liveModel(str(body.model, 60), /^gemini-[a-z0-9.\-]+$/i, k.mode, env.models.geminiLive);
  const now = Date.now();
  const expireTime = new Date(now + 30 * 60000).toISOString();
  let r: Response;
  try {
    r = await fetch(geminiTokenUrl(env.bases.gemini), {
      method: 'POST',
      headers: { 'x-goog-api-key': k.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime: new Date(now + 2 * 60000).toISOString(),
        bidiGenerateContentSetup: { model: `models/${model}`, generationConfig: { responseModalities: ['AUDIO'] } },
        fieldMask: 'model,generationConfig.responseModalities',
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: 'Gemini에 연결하지 못했어요.' });
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) return json(r.status, { error: 'upstream_error', message: (j.error as { message?: string })?.message || `Gemini 오류 (${r.status})` });
  const token = (j.name as string) || ((j.token as { name?: string })?.name) || '';
  if (!token) return json(502, { error: 'no_token', message: 'Gemini가 임시 토큰을 돌려주지 않았어요.' });
  return json(200, { token, model, expiresAt: expireTime });
}
