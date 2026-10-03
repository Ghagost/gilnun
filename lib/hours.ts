import { JST_OFFSET_MIN, fmtHM, wallTime } from './format';

/** day: 0 = Sunday … 6 = Saturday (Google convention). */
export type HoursPoint = { day: number; hour: number; minute: number };
export type HoursPeriod = { open: HoursPoint; close?: HoursPoint | null };

export type OpenStatus = {
  open: boolean;
  /** When the current open period ends (if open and it ends). */
  closesAt?: Date;
  /** Next opening (if closed and known). */
  opensAt?: Date;
  /** Open around the clock. */
  allDay?: boolean;
};

const WEEK = 7 * 1440;
const toMin = (p: HoursPoint) => p.day * 1440 + p.hour * 60 + p.minute;

export function isAlwaysOpen(periods: HoursPeriod[]): boolean {
  return periods.length === 1 && !periods[0].close && periods[0].open.day === 0 && periods[0].open.hour === 0 && periods[0].open.minute === 0;
}

/** Open/closed status at `at` for weekly periods given in local time at `utcOffsetMin`. */
export function statusAt(periods: HoursPeriod[] | null | undefined, at: Date = new Date(), utcOffsetMin = JST_OFFSET_MIN): OpenStatus | null {
  if (!periods || !periods.length) return null;
  if (isAlwaysOpen(periods)) return { open: true, allDay: true };
  const w = wallTime(at, utcOffsetMin);
  const m = w.weekday * 1440 + w.hour * 60 + w.minute;
  let bestNext = Infinity;
  for (const p of periods) {
    if (!p || !p.open) continue;
    const start = toMin(p.open);
    if (!p.close) {
      // Open from `start` with no end — treat as open from then on for this week cycle.
      if (m >= start) return { open: true, allDay: true };
      bestNext = Math.min(bestNext, start - m);
      continue;
    }
    let end = toMin(p.close);
    if (end <= start) end += WEEK;
    for (const mm of [m, m + WEEK]) {
      if (mm >= start && mm < end) {
        return { open: true, closesAt: new Date(at.getTime() + (end - mm) * 60000) };
      }
    }
    let delta = start - m;
    if (delta <= 0) delta += WEEK;
    bestNext = Math.min(bestNext, delta);
  }
  return { open: false, opensAt: Number.isFinite(bestNext) ? new Date(at.getTime() + bestNext * 60000) : undefined };
}

export type StatusLabel = { text: string; tone: 'open' | 'soon' | 'closed' | 'unknown' };

/** Korean one-liner: "영업 중 · 22:00에 닫음", "곧 닫음 · 21:30", "영업 종료 · 내일 11:00 열림". */
export function statusLabel(st: OpenStatus | null, now: Date = new Date(), utcOffsetMin = JST_OFFSET_MIN): StatusLabel {
  if (!st) return { text: '영업시간 정보 없음', tone: 'unknown' };
  if (st.open) {
    if (st.allDay || !st.closesAt) return { text: '24시간 영업', tone: 'open' };
    const mins = (st.closesAt.getTime() - now.getTime()) / 60000;
    const t = fmtHM(st.closesAt, utcOffsetMin);
    if (mins <= 60) return { text: `곧 닫음 · ${t}`, tone: 'soon' };
    return { text: `영업 중 · ${t}에 닫음`, tone: 'open' };
  }
  if (!st.opensAt) return { text: '영업 종료', tone: 'closed' };
  return { text: `영업 종료 · ${dayWord(now, st.opensAt, utcOffsetMin)} ${fmtHM(st.opensAt, utcOffsetMin)} 열림`, tone: 'closed' };
}

function dayWord(now: Date, when: Date, off: number): string {
  const a = wallTime(now, off), b = wallTime(when, off);
  const da = Date.UTC(a.year, a.month - 1, a.day), db = Date.UTC(b.year, b.month - 1, b.day);
  const diff = Math.round((db - da) / 86400000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '내일';
  return ['일', '월', '화', '수', '목', '금', '토'][b.weekday] + '요일';
}

/**
 * Warning when someone arriving after `travelMin` minutes would find it closed
 * (or closing within 30 minutes of arrival).
 */
export function arrivalWarning(periods: HoursPeriod[] | null | undefined, travelMin: number, now: Date = new Date(), utcOffsetMin = JST_OFFSET_MIN): string | null {
  if (!periods?.length || !Number.isFinite(travelMin)) return null;
  const arrive = new Date(now.getTime() + travelMin * 60000);
  const st = statusAt(periods, arrive, utcOffsetMin);
  if (!st) return null;
  const at = fmtHM(arrive, utcOffsetMin);
  if (!st.open) return `도착 예상 ${at}에는 영업이 끝나 있어요`;
  if (st.closesAt && st.closesAt.getTime() - arrive.getTime() <= 30 * 60000) return `도착 예상 ${at}, 닫기 ${Math.max(0, Math.round((st.closesAt.getTime() - arrive.getTime()) / 60000))}분 전이에요`;
  return null;
}

/* ---------- OpenStreetMap opening_hours (common subset) ---------- */

const OSM_DAYS: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

function expandDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const p = part.trim();
    const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)$/.exec(p);
    if (range) {
      // Iterate in Mo..Su order, wrapping.
      const order = [1, 2, 3, 4, 5, 6, 0];
      const a = order.indexOf(OSM_DAYS[range[1]]), b = order.indexOf(OSM_DAYS[range[2]]);
      let i = a;
      for (let guard = 0; guard < 8; guard++) { out.add(order[i]); if (i === b) break; i = (i + 1) % 7; }
      continue;
    }
    if (p in OSM_DAYS) { out.add(OSM_DAYS[p]); continue; }
    if (p === 'PH' || p === 'SH') continue; // holidays: ignore
    return null;
  }
  return [...out];
}

/**
 * Parses common OSM opening_hours strings into weekly periods.
 * Supports "24/7", "Mo-Fr 09:00-18:00; Sa 10:00-17:00", "Mo-Su 11:00-15:00,17:00-23:30",
 * "Mo-Sa 18:00-02:00", "Su off", and bare "10:00-20:00" (every day).
 * Returns null when the string uses syntax outside this subset.
 */
export function parseOsmHours(input: string | null | undefined): HoursPeriod[] | null {
  if (!input) return null;
  const s = input.trim();
  if (s === '24/7') return [{ open: { day: 0, hour: 0, minute: 0 }, close: null }];
  const byDay = new Map<number, { o: number; c: number }[]>();
  for (const ruleRaw of s.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule) continue;
    let daysPart = 'Mo-Su', timesPart = rule;
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)\s+(.*)$/.exec(rule);
    if (m) { daysPart = m[1].replace(/\s+/g, '').replace(/,$/, ''); timesPart = m[2].trim(); }
    const days = expandDays(daysPart);
    if (!days) return null;
    if (/^(off|closed)$/i.test(timesPart)) { for (const d of days) byDay.set(d, []); continue; }
    const ranges: { o: number; c: number }[] = [];
    for (const tr of timesPart.split(',')) {
      const t = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/.exec(tr.trim());
      if (!t) return null;
      const o = Number(t[1]) * 60 + Number(t[2]);
      let c = Number(t[3]) * 60 + Number(t[4]);
      if (o > 24 * 60 || c > 48 * 60) return null;
      if (c <= o) c += 24 * 60; // past midnight
      ranges.push({ o, c });
    }
    for (const d of days) byDay.set(d, ranges);
  }
  const periods: HoursPeriod[] = [];
  for (const [day, ranges] of byDay) {
    for (const r of ranges) {
      const oDay = day, cAbs = day * 1440 + r.c;
      const cDay = Math.floor(cAbs / 1440) % 7, cMin = cAbs % 1440;
      periods.push({ open: { day: oDay, hour: Math.floor(r.o / 60), minute: r.o % 60 }, close: { day: cDay, hour: Math.floor(cMin / 60), minute: cMin % 60 } });
    }
  }
  return periods.length ? periods : null;
}

/** Human-readable Korean weekday lines built from periods (Mon first). */
export function weekdayLines(periods: HoursPeriod[] | null | undefined): string[] {
  if (!periods?.length) return [];
  if (isAlwaysOpen(periods)) return ['매일 24시간'];
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const pad = (n: number) => String(n).padStart(2, '0');
  return order.map(d => {
    const ps = periods.filter(p => p.open.day === d).sort((a, b) => toMin(a.open) - toMin(b.open));
    if (!ps.length) return `${names[d]}  휴무`;
    const txt = ps.map(p => `${pad(p.open.hour)}:${pad(p.open.minute)}–${p.close ? `${pad(p.close.hour)}:${pad(p.close.minute)}` : ''}`).join(', ');
    return `${names[d]}  ${txt}`;
  });
}
