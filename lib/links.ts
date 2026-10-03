import type { LatLng } from './geo';

export type LinkTarget = LatLng & { name?: string; placeId?: string | null };
export type TravelMode = 'transit' | 'walking' | 'driving' | 'bicycling';

const q = encodeURIComponent;
const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Maps directions (opens the Google Maps app on phones). */
export function googleDirections(dest: LinkTarget, mode: TravelMode, origin?: LinkTarget | null): string {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  if (origin) {
    u.searchParams.set('origin', ll(origin));
    if (origin.placeId) u.searchParams.set('origin_place_id', origin.placeId);
  }
  u.searchParams.set('destination', ll(dest));
  if (dest.placeId) u.searchParams.set('destination_place_id', dest.placeId);
  u.searchParams.set('travelmode', mode);
  if (mode === 'walking' || mode === 'driving') u.searchParams.set('dir_action', 'navigate');
  return u.toString();
}

/** Google Maps place page (has "Reserve", photos, reviews). */
export function googlePlace(p: LinkTarget): string {
  const u = new URL('https://www.google.com/maps/search/');
  u.searchParams.set('api', '1');
  u.searchParams.set('query', p.name || ll(p));
  if (p.placeId) u.searchParams.set('query_place_id', p.placeId);
  return u.toString();
}

/** Google Maps search for a term around a point. */
export function googleSearchHere(term: string, center: LatLng, zoom = 16): string {
  return `https://www.google.com/maps/search/${q(term)}/@${ll(center)},${zoom}z`;
}

export function webSearch(query: string): string {
  return `https://www.google.com/search?q=${q(query)}`;
}

export function siteSearch(site: string, query: string): string {
  return webSearch(`site:${site} ${query}`);
}

export function uber(dest: LinkTarget): string {
  const u = new URL('https://m.uber.com/ul/');
  u.searchParams.set('action', 'setPickup');
  u.searchParams.set('pickup', 'my_location');
  u.searchParams.set('dropoff[latitude]', dest.lat.toFixed(6));
  u.searchParams.set('dropoff[longitude]', dest.lng.toFixed(6));
  if (dest.name) u.searchParams.set('dropoff[nickname]', dest.name);
  return u.toString();
}

/** tel: link from a Japanese/international number ("03-1234-5678", "+81 3-1234-5678"). */
export function tel(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, '');
  if (!/\d{6,}/.test(digits)) return null;
  return `tel:${digits}`;
}

/** Booking.com hotel search with dates (dates: YYYY-MM-DD). */
export function bookingCom(name: string, checkin?: string, checkout?: string, adults = 2, rooms = 1): string {
  const u = new URL('https://www.booking.com/searchresults.ko.html');
  u.searchParams.set('ss', name);
  if (checkin && checkout) { u.searchParams.set('checkin', checkin); u.searchParams.set('checkout', checkout); }
  u.searchParams.set('group_adults', String(Math.max(1, adults)));
  u.searchParams.set('no_rooms', String(Math.max(1, rooms)));
  u.searchParams.set('group_children', '0');
  return u.toString();
}

export function googleHotels(name: string): string {
  return `https://www.google.com/travel/search?q=${q(name)}`;
}

export function klook(query: string): string {
  return `https://www.klook.com/ko/search/result/?query=${q(query)}`;
}

export function kkday(query: string): string {
  return `https://www.kkday.com/ko/product/productlist?keyword=${q(query)}`;
}

export type BookingKind = 'restaurant' | 'hotel' | 'activity' | 'rental' | 'train' | 'other';

export type BookingOption = { id: string; label: string; sub: string; url: string; primary?: boolean };

/**
 * Where a traveller can book this kind of place. Search-style links are used on purpose:
 * partner sites change their deep-link formats, while site search keeps working.
 */
export function bookingOptions(kind: BookingKind, p: { name: string; nameJa?: string; placeId?: string | null; lat: number; lng: number; website?: string | null },
  o: { date?: string; time?: string; checkout?: string; people?: number } = {}): BookingOption[] {
  const nm = p.nameJa || p.name;
  const g = googlePlace({ lat: p.lat, lng: p.lng, name: p.name, placeId: p.placeId });
  const out: BookingOption[] = [];
  if (p.website) out.push({ id: 'web', label: '공식 웹사이트', sub: '예약 버튼이 있는지 확인', url: p.website });
  if (kind === 'restaurant') {
    out.push({ id: 'gmaps', label: '구글 지도에서 예약', sub: '“예약하기” 버튼이 있으면 바로 예약', url: g, primary: true });
    out.push({ id: 'tabelog', label: '타베로그 (食べログ)', sub: '일본 최대 맛집 예약·평점', url: siteSearch('tabelog.com', nm) });
    out.push({ id: 'tablecheck', label: 'TableCheck', sub: '외국어 지원 레스토랑 예약', url: siteSearch('tablecheck.com', nm) });
    out.push({ id: 'hotpepper', label: '핫페퍼 구르메', sub: '이자카야·단체 예약', url: siteSearch('hotpepper.jp', nm) });
    out.push({ id: 'opentable', label: 'OpenTable', sub: '고급 레스토랑', url: siteSearch('opentable.jp', nm) });
  } else if (kind === 'hotel') {
    out.push({ id: 'booking', label: 'Booking.com', sub: o.date ? `${o.date} 체크인 · ${o.people || 2}명` : '날짜를 넣으면 요금이 바로 나와요', url: bookingCom(p.name, o.date, o.checkout, o.people || 2), primary: true });
    out.push({ id: 'ghotels', label: '구글 호텔 가격 비교', sub: '여러 사이트 요금 비교', url: googleHotels(p.name) });
    out.push({ id: 'agoda', label: '아고다', sub: '한국어 고객센터', url: siteSearch('agoda.com', p.name) });
    out.push({ id: 'jalan', label: '자란 (じゃらん)', sub: '료칸·일본 현지 숙소', url: siteSearch('jalan.net', nm) });
    out.push({ id: 'gmaps', label: '구글 지도', sub: '사진·리뷰·요금', url: g });
  } else if (kind === 'activity') {
    out.push({ id: 'klook', label: '클룩 (Klook)', sub: '입장권·투어·패스', url: klook(p.name), primary: true });
    out.push({ id: 'kkday', label: 'KKday', sub: '입장권·투어', url: kkday(p.name) });
    out.push({ id: 'official', label: '공식 예약 찾기', sub: '공식 사이트가 더 쌀 때가 많아요', url: webSearch(`${nm} 予約 公式`) });
    out.push({ id: 'gmaps', label: '구글 지도', sub: '운영 시간·리뷰', url: g });
  } else if (kind === 'rental') {
    out.push({ id: 'compare', label: '렌터카 비교 (일본)', sub: '토요타·닛폰·타임즈 등 비교', url: webSearch(`${nm} レンタカー 予約`), primary: true });
    out.push({ id: 'gmaps', label: '구글 지도', sub: '영업소 위치·영업시간', url: g });
  } else if (kind === 'train') {
    out.push({ id: 'smartex', label: '신칸센 (스마트EX)', sub: '도카이도·산요 신칸센', url: 'https://smart-ex.jp/', primary: true });
    out.push({ id: 'ekinet', label: 'JR동일본 (에키넷)', sub: '도호쿠·호쿠리쿠 신칸센, 특급', url: 'https://www.eki-net.com/' });
    out.push({ id: 'jrwest', label: 'JR서일본 온라인 예약', sub: '하루카·간사이 지역', url: 'https://www.westjr.co.jp/global/kr/' });
  } else {
    out.push({ id: 'gmaps', label: '구글 지도', sub: '예약·연락처 확인', url: g, primary: true });
    out.push({ id: 'search', label: '예약 방법 검색', sub: '일본어로 검색', url: webSearch(`${nm} 予約`) });
  }
  return out;
}

export function bookingKindFor(category: string | null | undefined): BookingKind {
  switch (category) {
    case 'food': case 'cafe': return 'restaurant';
    case 'hotel': return 'hotel';
    case 'sight': return 'activity';
    case 'rental': return 'rental';
    case 'station': return 'train';
    default: return 'other';
  }
}

/**
 * Rough Japanese taxi fare (yen) for a straight-line distance.
 * Tokyo-style meter: ¥500 for the first 1.096 km, then ¥100 per 255 m, road ≈ straight × 1.3.
 * Late night (22:00–05:00) adds 20 %.
 */
export function taxiFareEstimate(straightMeters: number, lateNight = false): { low: number; high: number } {
  const road = straightMeters * 1.3;
  let fare = 500;
  if (road > 1096) fare += Math.ceil((road - 1096) / 255) * 100;
  if (lateNight) fare *= 1.2;
  const round = (n: number) => Math.round(n / 100) * 100;
  return { low: round(fare * 0.9), high: round(fare * 1.25) };
}
