import { serverEnv } from './env';

export type LimitRule = { name: string; id: string; limit: number; windowSec: number };
export type LimitResult = { ok: true } | { ok: false; rule: string; retryAfter: number };

/* ---------- in-memory store (single instance; fine for dev and small deployments) ---------- */
const mem = new Map<string, { n: number; exp: number }>();
const MAX_KEYS = 20000;

function memIncr(key: string, ttlSec: number, now: number): number {
  const cur = mem.get(key);
  if (cur && cur.exp > now) { cur.n++; return cur.n; }
  if (mem.size > MAX_KEYS) {
    for (const [k, v] of mem) { if (v.exp <= now) mem.delete(k); }
    if (mem.size > MAX_KEYS) mem.clear();
  }
  mem.set(key, { n: 1, exp: now + ttlSec * 1000 });
  return 1;
}

/* ---------- Upstash Redis REST (shared across serverless instances) ---------- */
async function upstashIncr(url: string, token: string, key: string, ttlSec: number): Promise<number> {
  const r = await fetch(`${url.replace(/\/+$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(ttlSec), 'NX']]),
    signal: AbortSignal.timeout(2500),
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  const j = (await r.json()) as { result?: unknown; error?: string }[];
  const n = Number(j?.[0]?.result);
  if (!Number.isFinite(n)) throw new Error('upstash bad reply');
  return n;
}

/** Fixed-window counters. Fails open (allows) if the shared store is unreachable. */
export async function checkLimits(rules: LimitRule[], now = Date.now()): Promise<LimitResult> {
  const { upstash } = serverEnv();
  for (const r of rules) {
    if (!r.limit || r.limit <= 0) continue;
    const win = Math.floor(now / 1000 / r.windowSec);
    const key = `gl:${r.name}:${r.id}:${win}`;
    let n: number;
    try {
      n = upstash.url && upstash.token ? await upstashIncr(upstash.url, upstash.token, key, r.windowSec + 5) : memIncr(key, r.windowSec + 5, now);
    } catch {
      n = memIncr(key, r.windowSec + 5, now);
    }
    if (n > r.limit) {
      const retryAfter = Math.max(1, (win + 1) * r.windowSec - Math.floor(now / 1000));
      return { ok: false, rule: r.name, retryAfter };
    }
  }
  return { ok: true };
}

export function resetMemoryLimits() {
  mem.clear();
}

/** Client identity for rate limiting. */
export function clientIds(req: Request): { ip: string; device: string } {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for') || '';
  const ip = (fwd.split(',')[0] || h.get('x-real-ip') || h.get('cf-connecting-ip') || 'unknown').trim().slice(0, 64);
  const dev = (h.get('x-device-id') || '').trim();
  const device = /^[A-Za-z0-9_-]{8,64}$/.test(dev) ? dev : `ip-${ip}`;
  return { ip, device };
}

export function tooMany(retryAfter: number, rule: string): Response {
  return Response.json(
    { error: 'rate_limited', rule, retryAfter, message: `요청이 너무 많아요. ${retryAfter}초 뒤에 다시 시도해 주세요.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } },
  );
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
