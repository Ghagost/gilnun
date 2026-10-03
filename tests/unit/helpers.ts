import { vi } from 'vitest';

/** Builds an SSE body from event objects; `split` breaks the bytes at awkward places. */
export function sseBody(events: { event?: string; data: unknown }[], split = 7): ReadableStream<Uint8Array> {
  const text = events.map(e => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(i, i + split));
      i += split;
    },
  });
}

export function sseResponse(events: { event?: string; data: unknown }[], status = 200): Response {
  return new Response(sseBody(events), { status, headers: { 'Content-Type': 'text/event-stream' } });
}

export type Recorded = { url: string; init: RequestInit; body: any };

/** Replaces global fetch with a scripted sequence; returns the calls made. */
export function scriptFetch(responders: ((req: Recorded) => Response | Promise<Response>)[]) {
  const calls: Recorded[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: any = init.body;
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch { /* raw */ }
    const rec = { url, init, body };
    calls.push(rec);
    const r = responders.shift();
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r(rec);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}
