import type { AiProvider } from '../types';
import { AiError } from './types';

type HeaderFn = (provider: AiProvider | 'app') => Record<string, string>;
let headerFn: HeaderFn = () => ({});
let baseUrl = '';

/** Wires the app's auth headers (device id, access code, user keys) into all AI calls. */
export function configureTransport(opts: { headers: HeaderFn; base?: string }) {
  headerFn = opts.headers;
  baseUrl = opts.base ?? '';
}

export function appHeaders(provider: AiProvider | 'app' = 'app'): Record<string, string> {
  return headerFn(provider);
}

/** Extracts a readable message from our proxy or any provider's error body. */
export function errorMessage(body: unknown, status: number): string {
  const b = body as Record<string, unknown> | null;
  if (b) {
    if (typeof b.message === 'string' && b.message) return b.message;
    const e = b.error as Record<string, unknown> | string | undefined;
    if (typeof e === 'string') return e;
    if (e && typeof e.message === 'string') return e.message;
  }
  return `HTTP ${status}`;
}

export function classify(status: number, msg: string, body?: unknown): AiError {
  const code = (body as { error?: unknown })?.error;
  if (code === 'no_server_key') return new AiError('no_key', msg, status);
  if (code === 'access_code' || (status === 401 && /접속 코드/.test(msg))) return new AiError('access_code', msg, status);
  if (status === 401 || status === 403 || /api[ _-]?key|unauthori[sz]ed|permission/i.test(msg)) return new AiError('auth', msg, status);
  if (status === 429) return new AiError('rate', msg, status);
  if (status === 413) return new AiError('too_large', msg, status);
  if (status === 404 || (status === 400 && /model/i.test(msg) && !/reasoning|thinking|effort|parameter|output_config|text\.format/i.test(msg))) return new AiError('model', msg, status);
  if (status >= 500) return new AiError('server', msg, status);
  return new AiError('bad_request', msg, status);
}

/** POST to the app's AI proxy. Throws AiError for non-2xx answers. */
export async function aiPost(provider: AiProvider, path: string, body: unknown, signal?: AbortSignal, query = ''): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(`${baseUrl}/api/ai/${provider}/${path}${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headerFn(provider) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new AiError('cancelled', '멈췄어요.');
    throw new AiError('network', '인터넷 연결을 확인해 주세요.');
  }
  if (!r.ok) {
    let j: unknown = null;
    try { j = await r.json(); } catch { /* not json */ }
    throw classify(r.status, errorMessage(j, r.status), j);
  }
  return r;
}

/** Korean, user-facing explanation for an AI failure. */
export function aiErrorText(e: unknown): string {
  if (e instanceof AiError) {
    switch (e.code) {
      case 'no_key': return 'AI 키가 없어요. 설정 → AI에서 내 키를 넣거나, 서버에 키를 설정해 주세요.';
      case 'access_code': return '접속 코드가 필요해요. 설정 → AI에서 접속 코드를 넣어 주세요.';
      case 'auth': return 'API 키가 맞지 않거나 권한이 없어요. 설정에서 키를 확인해 주세요.';
      case 'rate': return `요청이 많거나 사용 한도에 걸렸어요. 잠시 후 다시 시도해 주세요.${e.message && !/HTTP/.test(e.message) ? ` (${e.message.slice(0, 80)})` : ''}`;
      case 'model': return `모델 이름을 확인해 주세요. (${e.message.slice(0, 120)})`;
      case 'too_large': return '사진이 너무 커요. 다른 사진으로 다시 시도해 주세요.';
      case 'server': return 'AI 서버가 바빠요. 잠시 후 다시 시도해 주세요.';
      case 'network': return '인터넷 연결을 확인해 주세요.';
      case 'cancelled': return '멈췄어요.';
      case 'content': return 'AI가 이 요청에는 답하지 않았어요. 질문을 바꿔 보세요.';
      default: return `AI 오류: ${e.message.slice(0, 160)}`;
    }
  }
  if ((e as Error)?.name === 'AbortError') return '멈췄어요.';
  return `AI 오류: ${String((e as Error)?.message || e).slice(0, 160)}`;
}
