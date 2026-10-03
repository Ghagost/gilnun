import { category, categoryFromGoogleType, type CategoryKey } from '../categories';
import { distance, type LatLng } from '../geo';
import type { HoursPeriod } from '../hours';
import type { PhotoRef, PlaceDetails, PlaceSummary, Review } from '../types';
import type { NearbyOpts, PlacesProvider, Suggestion, TextOpts } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type GPlace = google.maps.places.Place;

const LIST_FIELDS = ['id', 'displayName', 'location', 'primaryType', 'primaryTypeDisplayName', 'types', 'formattedAddress', 'rating', 'userRatingCount', 'priceLevel', 'regularOpeningHours', 'utcOffsetMinutes', 'businessStatus', 'photos', 'googleMapsURI'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteURI', 'reviews', 'editorialSummary', 'reviewSummary', 'paymentOptions', 'accessibilityOptions', 'isReservable', 'hasDineIn', 'hasTakeout', 'hasDelivery', 'servesVegetarianFood', 'servesBreakfast', 'servesLunch', 'servesDinner', 'servesBeer', 'servesWine', 'isGoodForGroups', 'isGoodForChildren', 'priceRange'];
const FIELD_ALIASES: Record<string, string> = { regularOpeningHours: 'openingHours', websiteURI: 'websiteUri', googleMapsURI: 'googleMapsUri' };

/** Removes or swaps fields the loaded Maps version rejects, then retries (max 4 times). */
async function withFields<T>(fields: string[], run: (f: string[]) => Promise<T>): Promise<T> {
  let f = [...fields];
  for (let i = 0; i < 4; i++) {
    try { return await run(f); } catch (e) {
      const msg = String((e as Error)?.message || e);
      const bad = f.find(x => new RegExp(`\\b${x}\\b`).test(msg));
      if (!bad || !/field|invalid|unknown|not.*(supported|valid)/i.test(msg)) throw e;
      const alias = FIELD_ALIASES[bad];
      f = f.filter(x => x !== bad);
      if (alias && !f.includes(alias)) f.push(alias);
      delete FIELD_ALIASES[bad];
    }
  }
  return run(f);
}

const get = (pl: unknown, k: string): any => { try { return (pl as any)?.[k]; } catch { return undefined; } };

const PRICE: Record<string, number> = { FREE: 0, INEXPENSIVE: 1, MODERATE: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4, PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };

export function shortAddress(a?: string | null): string | undefined {
  if (!a) return undefined;
  return a.replace(/^(日本、|일본,?\s*|Japan,?\s*)/, '').replace(/〒\d{3}-\d{4}\s*/, '').replace(/^\d{3}-\d{4}\s*/, '').trim() || undefined;
}

function photoRef(ph: any): PhotoRef | null {
  if (!ph || typeof ph.getURI !== 'function') return null;
  const a = ph.authorAttributions?.[0];
  return { url: (w: number) => { try { return ph.getURI({ maxWidth: w }); } catch { return ''; } }, author: a?.displayName, authorUri: a?.uri };
}

function periodsOf(h: any): HoursPeriod[] | undefined {
  const ps = h?.periods;
  if (!Array.isArray(ps) || !ps.length) return undefined;
  const out: HoursPeriod[] = [];
  for (const p of ps) {
    const o = p?.open;
    if (!o || typeof o.day !== 'number') continue;
    const c = p.close;
    out.push({ open: { day: o.day, hour: o.hour ?? 0, minute: o.minute ?? 0 }, close: c && typeof c.day === 'number' ? { day: c.day, hour: c.hour ?? 0, minute: c.minute ?? 0 } : null });
  }
  return out.length ? out : undefined;
}

export function toSummary(pl: GPlace, center?: LatLng | null, catHint?: CategoryKey): PlaceSummary | null {
  const loc = get(pl, 'location');
  const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
  const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
  const id = get(pl, 'id');
  if (!id || typeof lat !== 'number' || typeof lng !== 'number') return null;
  const primary = get(pl, 'primaryType');
  let cat = categoryFromGoogleType(primary, get(pl, 'types'));
  if (cat === 'place' && catHint) cat = catHint;
  const pl0 = get(pl, 'priceLevel');
  const photos = get(pl, 'photos');
  return {
    id: `g:${id}`,
    source: 'google',
    placeId: id,
    name: get(pl, 'displayName') || '이름 없음',
    lat, lng,
    category: cat,
    typeLabel: get(pl, 'primaryTypeDisplayName') || undefined,
    address: shortAddress(get(pl, 'formattedAddress')),
    rating: typeof get(pl, 'rating') === 'number' ? get(pl, 'rating') : undefined,
    ratingCount: typeof get(pl, 'userRatingCount') === 'number' ? get(pl, 'userRatingCount') : undefined,
    priceLevel: pl0 != null ? PRICE[String(pl0)] : undefined,
    hours: periodsOf(get(pl, 'regularOpeningHours') ?? get(pl, 'openingHours')),
    utcOffset: typeof get(pl, 'utcOffsetMinutes') === 'number' ? get(pl, 'utcOffsetMinutes') : 540,
    businessStatus: get(pl, 'businessStatus') || undefined,
    photo: Array.isArray(photos) && photos.length ? photoRef(photos[0]) : null,
    googleMapsUri: get(pl, 'googleMapsURI') || get(pl, 'googleMapsUri') || undefined,
    distance: center ? Math.round(distance(center, { lat, lng })) : undefined,
  };
}

function reviewsOf(pl: GPlace): Review[] {
  const rs = get(pl, 'reviews');
  if (!Array.isArray(rs)) return [];
  return rs.slice(0, 5).map((r: any) => ({
    author: r?.authorAttribution?.displayName || '구글 사용자',
    authorUri: r?.authorAttribution?.uri,
    authorPhoto: r?.authorAttribution?.photoURI || r?.authorAttribution?.photoUri,
    rating: typeof r?.rating === 'number' ? r.rating : undefined,
    text: r?.text || r?.originalText || '',
    original: r?.originalText && r.originalText !== r.text ? r.originalText : undefined,
    lang: r?.textLanguageCode,
    when: r?.relativePublishTimeDescription,
  })).filter(r => r.text);
}

function summaryText(v: any): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  return v.text?.text || v.text || v.overview?.text || v.overview || undefined;
}

export class GooglePlaces implements PlacesProvider {
  readonly kind = 'google' as const;
  private session: google.maps.places.AutocompleteSessionToken | null = null;
  private predictions = new Map<string, any>();
  private localNames = new Map<string, { name: string; address?: string }>();
  constructor(private lang: 'ko' | 'ja' = 'ko') {}

  private P() { return google.maps.places; }

  async nearby(catKey: CategoryKey, center: LatLng, o: NearbyOpts = {}) {
    const C = category(catKey);
    const limit = Math.min(20, o.limit ?? 20);
    if (!C.gTypes && !o.gType) {
      // No Table A type: use text search near the point.
      const places = await this.text(o.keyword ? `${C.gText || C.ja} ${o.keyword}` : (C.gText || C.ja), center, { limit, radius: o.radius ?? C.ladder[1] ?? 1500 });
      return { places: places.map(p => ({ ...p, category: p.category === 'place' ? catKey : p.category })).sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)), radius: o.radius ?? C.ladder[1] ?? 1500 };
    }
    if (o.keyword) {
      const places = await this.text(`${o.keyword} ${C.ja}`, center, { limit, radius: o.radius ?? C.ladder[1] ?? 1500, type: o.gType || C.gTypes?.[0] });
      return { places: places.map(p => ({ ...p, category: p.category === 'place' ? catKey : p.category })), radius: o.radius ?? C.ladder[1] ?? 1500 };
    }
    const types = o.gType ? [o.gType] : C.gTypes!;
    const radii = o.radius ? [o.radius] : [C.ladder[1] ?? C.ladder[0], C.ladder[C.ladder.length - 1]];
    let places: PlaceSummary[] = [];
    let used = radii[0];
    for (const r of [...new Set(radii)]) {
      used = Math.min(50000, r);
      const res = await withFields(LIST_FIELDS, fields => this.P().Place.searchNearby({
        fields,
        locationRestriction: { center, radius: used },
        includedTypes: types,
        maxResultCount: limit,
        rankPreference: o.rank === 'popularity' ? this.P().SearchNearbyRankPreference.POPULARITY : this.P().SearchNearbyRankPreference.DISTANCE,
        language: this.lang,
        region: 'jp',
      } as google.maps.places.SearchNearbyRequest));
      places = (res.places || []).map(pl => toSummary(pl, center, catKey)).filter((p): p is PlaceSummary => !!p);
      if (places.length >= 5) break;
    }
    places.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return { places, radius: used };
  }

  async text(query: string, bias: LatLng | null, o: TextOpts = {}) {
    const req: Record<string, unknown> = {
      textQuery: query,
      maxResultCount: Math.min(20, o.limit ?? 10),
      language: this.lang,
      region: 'jp',
    };
    if (bias) req.locationBias = { center: bias, radius: Math.min(50000, o.radius ?? 5000) };
    if (o.openNow) req.openNow = true;
    if (o.minRating) req.minRating = o.minRating;
    if (o.type) req.includedType = o.type;
    const res = await withFields(LIST_FIELDS, fields => this.P().Place.searchByText({ ...req, fields } as unknown as google.maps.places.SearchByTextRequest));
    return (res.places || []).map(pl => toSummary(pl, bias)).filter((p): p is PlaceSummary => !!p);
  }

  async autocomplete(input: string, bias: LatLng | null): Promise<Suggestion[]> {
    if (!input.trim()) return [];
    const P = this.P() as any;
    if (!P.AutocompleteSuggestion) return [];
    this.session ||= new P.AutocompleteSessionToken();
    const req: Record<string, unknown> = { input, sessionToken: this.session, language: this.lang, region: 'jp' };
    if (bias) { req.locationBias = { center: bias, radius: 30000 }; req.origin = bias; }
    const { suggestions } = await P.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    this.predictions.clear();
    const out: Suggestion[] = [];
    for (const s of suggestions || []) {
      const pp = s.placePrediction;
      if (pp) {
        const id = `g:${pp.placeId}`;
        this.predictions.set(id, pp);
        out.push({
          id, kind: 'place', placeId: pp.placeId,
          main: pp.mainText?.text || pp.text?.text || '',
          secondary: shortAddress(pp.secondaryText?.text),
          distance: typeof pp.distanceMeters === 'number' ? pp.distanceMeters : undefined,
          category: categoryFromGoogleType(pp.types?.[0], pp.types),
          matches: (pp.mainText?.matches || []).map((m: any) => ({ start: m.startOffset ?? 0, end: m.endOffset ?? 0 })),
        });
      } else if (s.queryPrediction) {
        out.push({ id: `q:${s.queryPrediction.text?.text}`, kind: 'query', main: s.queryPrediction.text?.text || '' });
      }
    }
    return out.slice(0, 8);
  }

  async pick(s: Suggestion): Promise<PlaceSummary | null> {
    const pp = this.predictions.get(s.id);
    let pl: GPlace;
    if (pp?.toPlace) pl = pp.toPlace();
    else if (s.placeId) pl = new (this.P().Place)({ id: s.placeId, requestedLanguage: this.lang, requestedRegion: 'jp' } as google.maps.places.PlaceOptions);
    else return null;
    await withFields(DETAIL_FIELDS, fields => pl.fetchFields({ fields }));
    this.session = null; // a selection ends the billing session
    return toSummary(pl, null);
  }

  async details(p: PlaceSummary): Promise<PlaceDetails> {
    if (!p.placeId) return { ...p, fetchedAt: Date.now() };
    const pl = new (this.P().Place)({ id: p.placeId, requestedLanguage: this.lang, requestedRegion: 'jp' } as google.maps.places.PlaceOptions);
    await withFields(DETAIL_FIELDS, fields => pl.fetchFields({ fields }));
    const base = toSummary(pl, null, p.category) || p;
    const photos = get(pl, 'photos');
    const pay = get(pl, 'paymentOptions');
    const acc = get(pl, 'accessibilityOptions');
    const reg = get(pl, 'regularOpeningHours') ?? get(pl, 'openingHours');
    const attributions = get(pl, 'attributions');
    return {
      ...p,
      ...base,
      distance: p.distance,
      note: p.note,
      photos: Array.isArray(photos) ? photos.slice(0, 10).map(photoRef).filter((x): x is PhotoRef => !!x) : [],
      weekdayText: Array.isArray(reg?.weekdayDescriptions) ? reg.weekdayDescriptions : undefined,
      phone: get(pl, 'nationalPhoneNumber') || get(pl, 'internationalPhoneNumber') || undefined,
      website: get(pl, 'websiteURI') || get(pl, 'websiteUri') || undefined,
      reviews: reviewsOf(pl),
      reviewSummary: summaryText(get(pl, 'reviewSummary')),
      editorial: summaryText(get(pl, 'editorialSummary')),
      reservable: get(pl, 'isReservable') ?? undefined,
      payment: pay ? { card: pay.acceptsCreditCards ?? undefined, debit: pay.acceptsDebitCards ?? undefined, cashOnly: pay.acceptsCashOnly ?? undefined, nfc: pay.acceptsNFC ?? pay.acceptsNfc ?? undefined } : undefined,
      access: acc ? { entrance: acc.hasWheelchairAccessibleEntrance ?? undefined, restroom: acc.hasWheelchairAccessibleRestroom ?? undefined, seating: acc.hasWheelchairAccessibleSeating ?? undefined, parking: acc.hasWheelchairAccessibleParking ?? undefined } : undefined,
      dining: {
        dineIn: get(pl, 'hasDineIn') ?? undefined, takeout: get(pl, 'hasTakeout') ?? undefined, delivery: get(pl, 'hasDelivery') ?? undefined,
        vegetarian: get(pl, 'servesVegetarianFood') ?? undefined, breakfast: get(pl, 'servesBreakfast') ?? undefined, lunch: get(pl, 'servesLunch') ?? undefined,
        dinner: get(pl, 'servesDinner') ?? undefined, beer: get(pl, 'servesBeer') ?? undefined, wine: get(pl, 'servesWine') ?? undefined,
        groups: get(pl, 'isGoodForGroups') ?? undefined, kids: get(pl, 'isGoodForChildren') ?? undefined,
      },
      attributions: Array.isArray(attributions) ? attributions.map((a: any) => ({ name: a.provider || a.displayName || '', uri: a.providerURI || a.uri })).filter((a: { name: string }) => a.name) : undefined,
      fetchedAt: Date.now(),
    };
  }

  async localName(p: PlaceSummary) {
    if (!p.placeId) return p.nameLocal ? { name: p.nameLocal, address: p.address } : null;
    const hit = this.localNames.get(p.placeId);
    if (hit) return hit;
    const pl = new (this.P().Place)({ id: p.placeId, requestedLanguage: 'ja', requestedRegion: 'jp' } as google.maps.places.PlaceOptions);
    await withFields(['displayName', 'formattedAddress'], fields => pl.fetchFields({ fields }));
    const out = { name: get(pl, 'displayName') || p.name, address: shortAddress(get(pl, 'formattedAddress')) };
    this.localNames.set(p.placeId, out);
    return out;
  }
}
