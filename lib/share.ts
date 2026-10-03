/** Compact, URL-safe encoding of JSON payloads for share links (no server needed). */

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeShare(value: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'z' + toB64Url(await pipe(raw, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + toB64Url(raw);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export type SharedTrip = {
  title: string;
  city?: string;
  start: string;
  end: string;
  days: { date: string; stops: { place: { id: string; placeId?: string; name: string; nameLocal?: string; lat: number; lng: number; category: string; address?: string }; time?: string; note?: string }[] }[];
};

/** Validates a trip that arrived in a share link (untrusted input). */
export function parseSharedTrip(d: unknown): SharedTrip | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const start = str(o.start, 10), end = str(o.end, 10);
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || end < start) return null;
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(span) || span > 60) return null;
  const days: SharedTrip['days'] = [];
  for (const day of Array.isArray(o.days) ? o.days.slice(0, 61) : []) {
    const dd = day as Record<string, unknown>;
    const date = str(dd?.date, 10);
    if (!DATE_RE.test(date) || date < start || date > end) continue;
    const stops: SharedTrip['days'][number]['stops'] = [];
    for (const st of Array.isArray(dd.stops) ? dd.stops.slice(0, 40) : []) {
      const s = st as Record<string, unknown>;
      const p = (s?.place || {}) as Record<string, unknown>;
      const name = str(p.name, 120);
      if (!name || !fin(p.lat) || !fin(p.lng) || Math.abs(p.lat as number) > 90 || Math.abs(p.lng as number) > 180) continue;
      stops.push({
        place: {
          id: str(p.id, 200) || `c:${(p.lat as number).toFixed(5)},${(p.lng as number).toFixed(5)}`,
          placeId: str(p.placeId, 200) || undefined, name, nameLocal: str(p.nameLocal, 120) || undefined,
          lat: p.lat as number, lng: p.lng as number, category: str(p.category, 20) || 'place', address: str(p.address, 200) || undefined,
        },
        time: TIME_RE.test(str(s.time, 5)) ? str(s.time, 5) : undefined,
        note: str(s.note, 300) || undefined,
      });
    }
    days.push({ date, stops });
  }
  return { title: str(o.title, 60) || '공유받은 여행', city: str(o.city, 40) || undefined, start, end, days };
}

export async function decodeShare<T = unknown>(token: string): Promise<T | null> {
  if (!token || token.length < 2) return null;
  try {
    const kind = token[0];
    let bytes = fromB64Url(token.slice(1));
    if (kind === 'z') {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (kind !== 'j') return null;
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}
