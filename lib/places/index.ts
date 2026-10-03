import { category, type CategoryKey } from '../categories';
import type { LatLng } from '../geo';
import { googleReady } from '../map/googleLoader';
import { runtime } from '../store/runtime';
import { settings } from '../store/settings';
import type { PlaceDetails, PlaceSummary } from '../types';
import { GooglePlaces } from './google';
import { OsmPlaces } from './osm';
import type { NearbyOpts, PlacesProvider, Suggestion, TextOpts } from './types';

export const osmPlaces = new OsmPlaces();
let gp: GooglePlaces | null = null;

export function googleActive(): boolean {
  return runtime().engine === 'google' && googleReady();
}

export function activePlaces(): PlacesProvider {
  if (googleActive()) {
    gp ||= new GooglePlaces(settings().mapLang);
    return gp;
  }
  return osmPlaces;
}

/** Category search; categories Google has no type for (station exits) come from OpenStreetMap. */
export async function searchCategory(cat: CategoryKey, center: LatLng, o: NearbyOpts = {}) {
  const c = category(cat);
  const prov = c.osmOnly ? osmPlaces : activePlaces();
  try {
    return { ...(await prov.nearby(cat, center, o)), provider: prov.kind };
  } catch (e) {
    if (prov.kind === 'google' && c.osm) {
      // Google failed (quota, network): fall back to OSM so the user still gets results.
      return { ...(await osmPlaces.nearby(cat, center, o)), provider: 'osm' as const, fallback: String((e as Error)?.message || e) };
    }
    throw e;
  }
}

export async function searchText(q: string, bias: LatLng | null, o: TextOpts = {}) {
  const prov = activePlaces();
  try {
    return { places: await prov.text(q, bias, o), provider: prov.kind };
  } catch (e) {
    if (prov.kind === 'google') return { places: await osmPlaces.text(q, bias, o), provider: 'osm' as const, fallback: String((e as Error)?.message || e) };
    throw e;
  }
}

export async function autocomplete(input: string, bias: LatLng | null): Promise<Suggestion[]> {
  const prov = activePlaces();
  try { return await prov.autocomplete(input, bias); } catch {
    return prov.kind === 'google' ? osmPlaces.autocomplete(input, bias) : [];
  }
}

export async function pickSuggestion(s: Suggestion): Promise<PlaceSummary | null> {
  if (s.id.startsWith('g:') && googleActive()) return activePlaces().pick(s);
  return osmPlaces.pick(s);
}

export async function placeDetails(p: PlaceSummary): Promise<PlaceDetails> {
  if (p.placeId && googleActive()) return activePlaces().details(p);
  return osmPlaces.details(p);
}

export async function localName(p: PlaceSummary): Promise<{ name: string; address?: string } | null> {
  try {
    if (p.placeId && googleActive()) return await activePlaces().localName(p);
  } catch { /* fall through */ }
  return p.nameLocal ? { name: p.nameLocal, address: p.address } : null;
}

export type { Suggestion } from './types';
