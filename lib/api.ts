import { appHeaders } from './ai/transport';

/** Calls the app's own backend with device id / access code headers. */
export async function api<T = unknown>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const { timeout = 20000, headers, ...rest } = init;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const outer = rest.signal;
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true }); }
  try {
    const r = await fetch(path, { ...rest, signal: ctl.signal, headers: { ...(rest.body ? { 'Content-Type': 'application/json' } : {}), ...appHeaders('app'), ...(headers as Record<string, string> | undefined) } });
    let j: unknown = null;
    try { j = await r.json(); } catch { /* empty */ }
    if (!r.ok) {
      const msg = (j as { message?: string; error?: string } | null)?.message || (j as { error?: string } | null)?.error || `HTTP ${r.status}`;
      throw Object.assign(new Error(msg), { status: r.status, body: j });
    }
    return j as T;
  } finally { clearTimeout(t); }
}
