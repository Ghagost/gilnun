import { describe, expect, it } from 'vitest';
import { closeError, mergeTranscript } from '@/lib/live/gemini';
import { compactOutput } from '@/lib/live/tools';
import { forSpeech } from '@/lib/live/turn';
import { geminiTokenUrl } from '@/lib/server/live';
import { parseSharedTrip } from '@/lib/share';
import { relDirKo } from '@/lib/geo';
import { jaDate, jaTime, phoneScript } from '@/components/overlays/BookingSheet';
import { mergeScan } from '@/components/overlays/ReservationForm';
import { attribution } from '@/components/panels/ResultsPanel';

describe('live helpers', () => {
  it('merges chunked and cumulative transcripts', () => {
    expect(mergeTranscript('', '안녕')).toBe('안녕');
    expect(mergeTranscript('안녕', '하세요')).toBe('안녕하세요');
    expect(mergeTranscript('안녕', '안녕하세요')).toBe('안녕하세요');
  });
  it('explains WebSocket closes in Korean', () => {
    expect(closeError(1008, 'API key not valid. Please pass a valid API key.').code).toBe('auth');
    expect(closeError(1011, 'RESOURCE_EXHAUSTED: quota').code).toBe('rate');
    expect(closeError(1006, '').code).toBe('network');
    expect(closeError(1011, 'Internal error').message).toContain('Internal error');
  });
  it('keeps tool results small for voice models', () => {
    const big = compactOutput({ grounded_text: 'x'.repeat(5000), results: Array.from({ length: 20 }, (_, i) => ({ i })) });
    expect((big.grounded_text as string).length).toBe(1800);
    expect((big.results as unknown[]).length).toBe(6);
    expect(compactOutput('done')).toEqual({ result: 'done' });
  });
  it('reads answers aloud without markdown or place refs', () => {
    expect(forSpeech('**東口**으로 가세요 (P3)\n- 계단 [지도](https://x)')).toBe('東口으로 가세요 계단 지도');
  });
  it('names directions relative to the phone', () => {
    expect(relDirKo(5)).toBe('정면');
    expect(relDirKo(-40)).toBe('왼쪽 앞');
    expect(relDirKo(90)).toBe('오른쪽');
    expect(relDirKo(-140)).toBe('왼쪽 뒤');
    expect(relDirKo(179)).toBe('뒤쪽');
  });
  it('mints tokens on v1alpha', () => {
    expect(geminiTokenUrl('https://generativelanguage.googleapis.com/v1beta')).toBe('https://generativelanguage.googleapis.com/v1alpha/auth_tokens');
  });
});

describe('shared trips', () => {
  it('validates untrusted share links', () => {
    expect(parseSharedTrip(null)).toBeNull();
    expect(parseSharedTrip({ title: 'x', start: '2026-11-27', end: '2026-11-25' })).toBeNull();
    expect(parseSharedTrip({ title: 'x', start: '2026-01-01', end: '2026-06-01' })).toBeNull();
    const t = parseSharedTrip({
      title: 'Osaka', start: '2026-11-25', end: '2026-11-26',
      days: [
        { date: '2026-11-25', stops: [{ place: { id: 'g:1', name: 'Dotonbori', lat: 34.66, lng: 135.5, category: 'sight' }, time: '10:00' }, { place: { name: 'bad', lat: 'x', lng: 1 } }] },
        { date: '2027-01-01', stops: [] },
      ],
    })!;
    expect(t.days).toHaveLength(1);
    expect(t.days[0].stops).toHaveLength(1);
    expect(t.days[0].stops[0]).toMatchObject({ time: '10:00', place: { name: 'Dotonbori' } });
  });
});

describe('booking', () => {
  it('writes a polite Japanese phone script', () => {
    expect(jaDate('2026-11-24')).toBe('11月24日（火）');
    expect(jaTime('09:00')).toBe('9時');
    expect(jaTime('19:30')).toBe('19時30分');
    const s = phoneScript('restaurant', { date: '2026-11-24', time: '19:30', people: 2, name: 'KIM' });
    expect(s[1].ja).toBe('11月24日（火）の19時30分に、2名で予約できますか？');
    expect(s.some(l => l.ja === '名前はKIMです。')).toBe(true);
    expect(phoneScript('hotel', { date: '2026-11-25', checkout: '2026-11-29', people: 2 })[1].ja).toContain('4泊');
  });
  it('fills a reservation from what the AI read, ignoring junk', () => {
    const base = { kind: 'other' as const, title: '', date: '2026-11-01', time: '', endDate: '', endTime: '', people: '', confirmation: '', platform: '', price: '', note: '메모', status: 'pending' as const, place: null };
    const m = mergeScan(base, { kind: 'hotel', title: 'Hotel A', date: '2026-11-25', time: '15:00', end_date: '2026-11-29', people: 2, confirmation: 'X1', note: '조식 포함', bogus: 1 });
    expect(m).toMatchObject({ kind: 'hotel', title: 'Hotel A', date: '2026-11-25', time: '15:00', endDate: '2026-11-29', people: '2', confirmation: 'X1', status: 'booked' });
    expect(m.note).toBe('메모\n조식 포함');
    expect(mergeScan(base, { kind: 'spaceship', date: 'tomorrow', time: '7pm', people: -3 })).toMatchObject({ kind: 'other', date: '2026-11-01', time: '', people: '' });
  });
  it('credits every data source on the results list', () => {
    expect(attribution(['google', 'osm'], 'google')).toBe('Google 지도 데이터 · © OpenStreetMap 기여자');
    expect(attribution([], 'maplibre')).toBe('© OpenStreetMap 기여자');
  });
});
