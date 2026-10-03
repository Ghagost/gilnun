export type LatLng = { lat: number; lng: number };
export type Bounds = { north: number; south: number; east: number; west: number };

const RAD = Math.PI / 180;
const R = 6371000;

export function isLatLng(v: unknown): v is LatLng {
  const p = v as LatLng;
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Great-circle distance in metres. */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees (0 = north, clockwise). */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export function dirKo(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return DIRS[Math.round(d / 45) % 8];
}

/** Smallest absolute difference between two angles in degrees (0..180). */
export function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Signed shortest rotation from `from` to `to` in degrees (-180..180]. */
export function angDelta(from: number, to: number): number {
  const d = ((to - from + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Where a target lies relative to the way the phone points, from a signed `angDelta`. */
export function relDirKo(delta: number): string {
  const a = Math.abs(delta);
  if (a <= 20) return '정면';
  const side = delta > 0 ? '오른쪽' : '왼쪽';
  if (a <= 65) return `${side} 앞`;
  if (a <= 115) return side;
  if (a <= 160) return `${side} 뒤`;
  return '뒤쪽';
}

export function fmtDist(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

/** Walking minutes for a straight-line distance (detour factor 1.25, 80 m/min). */
export function walkMinutes(straightMeters: number): number {
  return Math.max(1, Math.round((straightMeters * 1.25) / 80));
}

export function inJapan(p: LatLng | null | undefined): boolean {
  return !!p && p.lat > 20 && p.lat < 46.5 && p.lng > 122 && p.lng < 154;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  const pts = points.filter(isLatLng);
  if (!pts.length) return null;
  let north = -90, south = 90, east = -180, west = 180;
  for (const p of pts) {
    north = Math.max(north, p.lat); south = Math.min(south, p.lat);
    east = Math.max(east, p.lng); west = Math.min(west, p.lng);
  }
  return { north, south, east, west };
}

export function centerOf(b: Bounds): LatLng {
  return { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
}

/** Polygon ring approximating a circle (for accuracy halos on non-Google maps). */
export function circleRing(c: LatLng, radius: number, n = 48): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.max(0.01, Math.cos(c.lat * RAD)));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return pts;
}

/** Parses "35.68,139.76" or "35.68, 139.76". */
export function parseLatLng(s: string | null | undefined): LatLng | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const p = { lat: Number(m[1]), lng: Number(m[2]) };
  return isLatLng(p) ? p : null;
}

export function roundLatLng(p: LatLng, digits = 3): LatLng {
  const f = 10 ** digits;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}

/** Decodes a Google encoded polyline. */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length + 1);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length + 1);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}
