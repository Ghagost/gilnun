/** Japan (and Korea) are UTC+9 all year, with no daylight saving time. */
export const JST_OFFSET_MIN = 9 * 60;

export type WallTime = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** Wall-clock parts of `date` at a fixed UTC offset (minutes). weekday: 0 = Sunday. */
export function wallTime(date: Date, offsetMin = JST_OFFSET_MIN): WallTime {
  const d = new Date(date.getTime() + offsetMin * 60000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

/** Builds a Date from wall-clock parts at a fixed UTC offset. */
export function fromWallTime(year: number, month: number, day: number, hour = 0, minute = 0, offsetMin = JST_OFFSET_MIN): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMin * 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];

export function fmtHM(date: Date, offsetMin = JST_OFFSET_MIN): string {
  const w = wallTime(date, offsetMin);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** "11월 23일 (월)" */
export function fmtDateKo(date: Date, offsetMin = JST_OFFSET_MIN): string {
  const w = wallTime(date, offsetMin);
  return `${w.month}월 ${w.day}일 (${WD[w.weekday]})`;
}

/** "2026-11-23" (local date at offset) */
export function isoDate(date: Date, offsetMin = JST_OFFSET_MIN): string {
  const w = wallTime(date, offsetMin);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Parses "2026-11-23" (+ optional "HH:MM") as JST wall time. */
export function parseJst(dateStr: string, time?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return null;
  let h = 0, min = 0;
  if (time) {
    const t = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!t) return null;
    h = Number(t[1]); min = Number(t[2]);
    if (h > 23 || min > 59) return null;
  }
  const d = fromWallTime(Number(m[1]), Number(m[2]), Number(m[3]), h, min);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(dateStr: string, n: number): string {
  const d = parseJst(dateStr);
  if (!d) return dateStr;
  return isoDate(new Date(d.getTime() + n * 86400000));
}

export function daysBetween(a: string, b: string): number {
  const da = parseJst(a), db = parseJst(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 65 -> "1시간 5분", 40 -> "40분" */
export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

export function fmtYen(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return `¥${Math.round(n).toLocaleString('ko-KR')}`;
}

export function fmtWon(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 10000) {
    const man = n / 10000;
    return `${man >= 100 ? Math.round(man).toLocaleString('ko-KR') : man.toFixed(man >= 10 ? 0 : 1).replace(/\.0$/, '')}만 원`;
  }
  return `${(Math.round(n / 10) * 10).toLocaleString('ko-KR')}원`;
}

/** "¥1,200 (약 1.0만 원)" */
export function yenWithWon(yen: number, rate: number): string {
  if (!Number.isFinite(yen)) return '';
  if (!rate || !Number.isFinite(rate)) return fmtYen(yen);
  return `${fmtYen(yen)} (약 ${fmtWon(yen * rate)})`;
}

export function relTimeKo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return prefix + r;
}

export function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
