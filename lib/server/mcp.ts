import { sseEvents } from '../sse';

/** Minimal MCP (Streamable HTTP) client: initialize → tools/list | tools/call. */

export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export type McpCallResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };

export class McpError extends Error {
  constructor(message: string, public code?: number, public status?: number) { super(message); }
}

type Session = { url: string; key: string; sessionId?: string; protocol: string; at: number };
const sessions = new Map<string, Session>();
const PROTOCOL = '2025-06-18';
let nextId = 1;

function headers(s: Session, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'X-Goog-Api-Key': s.key,
    'MCP-Protocol-Version': s.protocol,
  };
  if (s.sessionId) h['Mcp-Session-Id'] = s.sessionId;
  return { ...h, ...extra };
}

async function readRpc(r: Response, id: number): Promise<unknown> {
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/event-stream') && r.body) {
    for await (const ev of sseEvents(r.body)) {
      let msg: Record<string, unknown> | null = null;
      try { msg = JSON.parse(ev.data); } catch { continue; }
      if (msg && msg.id === id) return msg;
    }
    throw new McpError('no response in event stream');
  }
  const text = await r.text();
  if (!text) throw new McpError('empty response', undefined, r.status);
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed.find(m => m && m.id === id) ?? parsed[0];
  return parsed;
}

async function rpc(s: Session, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
  const id = nextId++;
  const r = await fetch(s.url, {
    method: 'POST',
    headers: headers(s),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (r.status === 404 && s.sessionId) throw new McpError('session expired', -32001, 404);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new McpError(`HTTP ${r.status} ${t.slice(0, 200)}`, undefined, r.status);
  }
  const sid = r.headers.get('mcp-session-id');
  if (sid) s.sessionId = sid;
  const msg = (await readRpc(r, id)) as { result?: unknown; error?: { code?: number; message?: string } };
  if (msg?.error) throw new McpError(msg.error.message || 'MCP error', msg.error.code);
  return msg?.result;
}

async function open(url: string, key: string): Promise<Session> {
  const cacheKey = `${url}|${key.slice(-8)}`;
  const cur = sessions.get(cacheKey);
  if (cur && Date.now() - cur.at < 10 * 60000) return cur;
  const s: Session = { url, key, protocol: PROTOCOL, at: Date.now() };
  const res = (await rpc(s, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'gilnun', version: '2.0.0' } }, 12000)) as { protocolVersion?: string } | undefined;
  if (res?.protocolVersion) s.protocol = res.protocolVersion;
  // Notification: no id, server answers 202 Accepted.
  try {
    await fetch(url, { method: 'POST', headers: headers(s), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: AbortSignal.timeout(8000) });
  } catch { /* optional */ }
  sessions.set(cacheKey, s);
  return s;
}

async function withSession<T>(url: string, key: string, fn: (s: Session) => Promise<T>): Promise<T> {
  let s = await open(url, key);
  try {
    return await fn(s);
  } catch (e) {
    if (e instanceof McpError && (e.code === -32001 || e.status === 404 || (e.status === 400 && /session/i.test(e.message)))) {
      sessions.delete(`${url}|${key.slice(-8)}`);
      s = await open(url, key);
      return await fn(s);
    }
    throw e;
  }
}

const toolCache = new Map<string, { at: number; tools: McpTool[] }>();

export async function mcpListTools(url: string, key: string): Promise<McpTool[]> {
  const ck = `${url}|${key.slice(-8)}`;
  const c = toolCache.get(ck);
  if (c && Date.now() - c.at < 60 * 60000) return c.tools;
  const res = (await withSession(url, key, s => rpc(s, 'tools/list', {}, 12000))) as { tools?: McpTool[] } | undefined;
  const tools = Array.isArray(res?.tools) ? res!.tools : [];
  toolCache.set(ck, { at: Date.now(), tools });
  return tools;
}

export async function mcpCallTool(url: string, key: string, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  return (await withSession(url, key, s => rpc(s, 'tools/call', { name, arguments: args }, 25000))) as McpCallResult;
}

export function resetMcpCaches() {
  sessions.clear();
  toolCache.clear();
}
