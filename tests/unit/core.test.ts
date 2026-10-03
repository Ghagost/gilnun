import { describe, expect, it } from 'vitest';
import { sseEvents } from '@/lib/sse';
import { bearing, decodePolyline, dirKo, distance, fmtDist, parseLatLng, walkMinutes } from '@/lib/geo';
import { addDays, daysBetween, fmtDateKo, fmtDuration, fmtHM, fmtWon, fromWallTime, isoDate, parseJst, wallTime, yenWithWon } from '@/lib/format';
import { arrivalWarning, parseOsmHours, statusAt, statusLabel, weekdayLines, type HoursPeriod } from '@/lib/hours';
import { bookingCom, bookingOptions, googleDirections, googlePlace, taxiFareEstimate, tel, uber } from '@/lib/links';
import { buildIcs, fold } from '@/lib/ics';
import { decodeShare, encodeShare } from '@/lib/share';
import { categoryFromGoogleType, cuisineKo } from '@/lib/categories';

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close(); } });
}
async function collect(s: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const e of sseEvents(s)) out.push(e);
  return out;
}

describe('sse parser', () => {
  it('handles split chunks, CRLF, CR, comments, multi-line data and a trailing event', async () => {
    const evs = await collect(stream([
      ': keepalive\r\n', 'event: a\r\ndata: {"x":', '1}\r\n\r', '\ndata: line1\ndata: line2\n\n', 'data: last', '',
    ]));
    expect(evs).toEqual([
      { event: 'a', data: '{"x":1}', id: undefined },
      { event: 'message', data: 'line1\nline2', id: undefined },
      { event: 'message', data: 'last', id: undefined },
    ]);
  });
  it('handles a lone CR line ending across chunks', async () => {
    const evs = await collect(stream(['data: one\r', '\r', 'data: two\r\r']));
    expect(evs.map(e => e.data)).toEqual(['one', 'two']);
  });
  it('decodes multi-byte UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: 신주쿠 駅\n\n');
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 8)); c.enqueue(bytes.slice(8)); c.close(); } });
    expect((await collect(s))[0].data).toBe('신주쿠 駅');
  });
});

describe('geo', () => {
  it('computes distance and bearing', () => {
    const tokyo = { lat: 35.6812, lng: 139.7671 }, shinjuku = { lat: 35.6896, lng: 139.7006 };
    const d = distance(tokyo, shinjuku);
    expect(d).toBeGreaterThan(6000); expect(d).toBeLessThan(6200);
    expect(dirKo(bearing(tokyo, shinjuku))).toBe('서');
    expect(fmtDist(84)).toBe('80m'); expect(fmtDist(1530)).toBe('1.5km'); expect(fmtDist(12400)).toBe('12km');
    expect(walkMinutes(640)).toBe(10);
    expect(parseLatLng('35.1, 139.2')).toEqual({ lat: 35.1, lng: 139.2 });
    expect(parseLatLng('abc')).toBeNull();
  });
  it('decodes Google polylines', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 },
    ]);
  });
});

describe('format (JST)', () => {
  it('converts wall time at +09:00 regardless of host timezone', () => {
    const d = fromWallTime(2026, 11, 23, 9, 5);
    expect(d.toISOString()).toBe('2026-11-23T00:05:00.000Z');
    expect(wallTime(d)).toMatchObject({ year: 2026, month: 11, day: 23, hour: 9, minute: 5, weekday: 1 });
    expect(fmtHM(d)).toBe('09:05');
    expect(fmtDateKo(d)).toBe('11월 23일 (월)');
    expect(isoDate(d)).toBe('2026-11-23');
    expect(parseJst('2026-11-23', '19:30')!.toISOString()).toBe('2026-11-23T10:30:00.000Z');
    expect(parseJst('2026-11-23', '25:00')).toBeNull();
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(daysBetween('2026-11-23', '2026-11-27')).toBe(4);
  });
  it('formats durations and money', () => {
    expect(fmtDuration(40)).toBe('40분'); expect(fmtDuration(65)).toBe('1시간 5분'); expect(fmtDuration(120)).toBe('2시간');
    expect(fmtWon(8650)).toBe('8,650원'); expect(fmtWon(86500)).toBe('8.7만 원'); expect(fmtWon(1234567)).toBe('123만 원');
    expect(yenWithWon(1000, 8.65)).toBe('¥1,000 (약 8,650원)');
  });
});

describe('opening hours', () => {
  // Mon-Sat 11:00-22:00, Sun closed, plus a late bar window Fri 23:00 → Sat 02:00
  const periods: HoursPeriod[] = [1, 2, 3, 4, 5, 6].map(day => ({ open: { day, hour: 11, minute: 0 }, close: { day, hour: 22, minute: 0 } }));
  periods.push({ open: { day: 5, hour: 23, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } });
  const at = (d: number, h: number, m = 0) => fromWallTime(2026, 11, 22 + d, h, m); // 2026-11-22 is a Sunday

  it('reports open/closed with next change', () => {
    const mon10 = statusAt(periods, at(1, 10));
    expect(mon10?.open).toBe(false);
    expect(fmtHM(mon10!.opensAt!)).toBe('11:00');
    const mon2130 = statusAt(periods, at(1, 21, 30));
    expect(mon2130?.open).toBe(true);
    expect(fmtHM(mon2130!.closesAt!)).toBe('22:00');
    expect(statusLabel(mon2130, at(1, 21, 30)).tone).toBe('soon');
    expect(statusLabel(statusAt(periods, at(1, 13)), at(1, 13)).text).toBe('영업 중 · 22:00에 닫음');
  });
  it('handles overnight periods and Sunday closure', () => {
    expect(statusAt(periods, at(6, 1))?.open).toBe(true); // Sat 01:00 (from Fri 23:00)
    const sun = statusAt(periods, at(0, 15));
    expect(sun?.open).toBe(false);
    expect(statusLabel(sun, at(0, 15)).text).toBe('영업 종료 · 내일 11:00 열림');
  });
  it('handles a week wrap (Sat 22:00 → Sun 02:00)', () => {
    const p: HoursPeriod[] = [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }];
    expect(statusAt(p, fromWallTime(2026, 11, 29, 1))?.open).toBe(true); // Sunday 01:00
    expect(statusAt(p, fromWallTime(2026, 11, 29, 3))?.open).toBe(false);
  });
  it('recognises 24/7 and warns about arrival time', () => {
    expect(statusAt([{ open: { day: 0, hour: 0, minute: 0 } }])).toEqual({ open: true, allDay: true });
    expect(arrivalWarning(periods, 40, at(1, 21, 30))).toBe('도착 예상 22:10에는 영업이 끝나 있어요');
    expect(arrivalWarning(periods, 10, at(1, 21, 15))).toBeNull();
    expect(arrivalWarning(periods, 20, at(1, 21, 15))).toBe('도착 예상 21:35, 닫기 25분 전이에요');
  });
  it('parses common OSM opening_hours', () => {
    const p = parseOsmHours('Mo-Fr 09:00-18:00; Sa 10:00-17:00; Su off')!;
    expect(p).toHaveLength(6);
    expect(statusAt(p, at(6, 16))?.open).toBe(true);
    expect(statusAt(p, at(0, 12))?.open).toBe(false);
    const late = parseOsmHours('Mo-Su 18:00-02:00')!;
    expect(statusAt(late, at(2, 1))?.open).toBe(true); // Tue 01:00 from Mon 18:00
    expect(parseOsmHours('24/7')).toEqual([{ open: { day: 0, hour: 0, minute: 0 }, close: null }]);
    expect(parseOsmHours('Mo-Su 11:00-15:00,17:00-23:30')).toHaveLength(14);
    expect(parseOsmHours('sunrise-sunset')).toBeNull();
    expect(weekdayLines(p)[0]).toBe('월  09:00–18:00');
    expect(weekdayLines(p)[6]).toBe('일  휴무');
  });
});

describe('links', () => {
  it('builds Google Maps URLs', () => {
    const u = new URL(googleDirections({ lat: 35.1, lng: 139.2, placeId: 'ChIJabc' }, 'transit'));
    expect(u.searchParams.get('destination')).toBe('35.100000,139.200000');
    expect(u.searchParams.get('destination_place_id')).toBe('ChIJabc');
    expect(u.searchParams.get('travelmode')).toBe('transit');
    expect(u.searchParams.get('dir_action')).toBeNull();
    expect(new URL(googleDirections({ lat: 1, lng: 2 }, 'walking')).searchParams.get('dir_action')).toBe('navigate');
    const p = new URL(googlePlace({ lat: 1, lng: 2, name: '一蘭', placeId: 'ChIJx' }));
    expect(p.searchParams.get('query')).toBe('一蘭');
    expect(p.searchParams.get('query_place_id')).toBe('ChIJx');
  });
  it('builds booking and taxi helpers', () => {
    const b = new URL(bookingCom('Hotel X', '2026-11-23', '2026-11-27', 2));
    expect(b.searchParams.get('checkin')).toBe('2026-11-23');
    expect(b.searchParams.get('group_adults')).toBe('2');
    expect(new URL(uber({ lat: 35, lng: 139, name: 'X' })).searchParams.get('dropoff[latitude]')).toBe('35.000000');
    expect(tel('+81 3-1234-5678')).toBe('tel:+81312345678');
    expect(tel('n/a')).toBeNull();
    const opts = bookingOptions('restaurant', { name: '이치란', nameJa: '一蘭', placeId: 'P', lat: 1, lng: 2 });
    expect(opts[0].id).toBe('gmaps');
    expect(opts.find(o => o.id === 'tabelog')!.url).toContain(encodeURIComponent('site:tabelog.com 一蘭'));
    const fare = taxiFareEstimate(3000);
    expect(fare.low).toBeGreaterThan(1000); expect(fare.high).toBeLessThan(3000);
  });
});

describe('ics', () => {
  it('builds a valid calendar with escaping and folding', () => {
    const ics = buildIcs([{ uid: 'r1', start: new Date('2026-11-23T10:30:00Z'), title: '이치란, 2명; 예약', location: '新宿', alarmMin: 60 }]);
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART:20261123T103000Z');
    expect(ics).toContain('DTEND:20261123T113000Z');
    expect(ics).toContain('SUMMARY:이치란\\, 2명\\; 예약');
    expect(ics).toContain('TRIGGER:-PT60M');
    const long = fold('DESCRIPTION:' + '가'.repeat(60));
    expect(long.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe('share', () => {
  it('round-trips compressed payloads', async () => {
    const v = { title: '오사카 4박5일', days: [{ date: '2026-11-25', stops: [{ name: '道頓堀', lat: 34.66, lng: 135.5 }] }] };
    const t = await encodeShare(v);
    expect(t[0]).toBe('z');
    expect(await decodeShare(t)).toEqual(v);
    expect(await decodeShare('zzz')).toBeNull();
  });
});

describe('categories', () => {
  it('maps Google types', () => {
    expect(categoryFromGoogleType('ramen_restaurant')).toBe('food');
    expect(categoryFromGoogleType('subway_station')).toBe('station');
    expect(categoryFromGoogleType(undefined, ['point_of_interest', 'shinto_shrine'])).toBe('sight');
    expect(cuisineKo('ramen;japanese')).toBe('라멘·일식');
  });
});
