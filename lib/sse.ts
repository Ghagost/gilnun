export type SseEvent = { event: string; data: string; id?: string };

/**
 * Parses a Server-Sent Events byte stream (WHATWG rules: \n, \r\n or \r line endings,
 * multi-line data, comments, and a final event without a trailing blank line).
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let pendingCR = false;

  const takeLine = (): string | null => {
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (ch === '\n' || ch === '\r') {
        const line = buf.slice(0, i);
        let skip = 1;
        if (ch === '\r') {
          if (i + 1 < buf.length) { if (buf[i + 1] === '\n') skip = 2; }
          else pendingCR = true;
        }
        buf = buf.slice(i + skip);
        return line;
      }
    }
    return null;
  };

  function* flushLine(line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length) yield { event: event || 'message', data: data.join('\n'), id };
      event = ''; data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const c = line.indexOf(':');
    const field = c === -1 ? line : line.slice(0, c);
    let value = c === -1 ? '' : line.slice(c + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = decoder.decode(value, { stream: true });
      if (pendingCR) { pendingCR = false; if (chunk.startsWith('\n')) chunk = chunk.slice(1); }
      buf += chunk;
      let line: string | null;
      while ((line = takeLine()) !== null) yield* flushLine(line);
    }
    buf += decoder.decode();
    if (buf.length) { yield* flushLine(buf); buf = ''; }
    if (data.length) yield { event: event || 'message', data: data.join('\n'), id };
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/** Parses JSON from an SSE data field; returns null for "[DONE]" or invalid JSON. */
export function sseJson<T = unknown>(data: string): T | null {
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data) as T; } catch { return null; }
}
