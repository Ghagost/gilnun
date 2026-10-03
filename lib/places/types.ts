import type { CategoryKey } from '../categories';
import type { LatLng } from '../geo';
import type { PlaceDetails, PlaceSummary } from '../types';

export type Suggestion = {
  id: string;
  kind: 'place' | 'query';
  main: string;
  secondary?: string;
  distance?: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  category?: CategoryKey;
  matches?: { start: number; end: number }[];
};

export type NearbyOpts = { keyword?: string; gType?: string; radius?: number; rank?: 'distance' | 'popularity'; limit?: number };
export type TextOpts = { openNow?: boolean; minRating?: number; limit?: number; type?: string; radius?: number };

export interface PlacesProvider {
  readonly kind: 'google' | 'osm';
  nearby(cat: CategoryKey, center: LatLng, o?: NearbyOpts): Promise<{ places: PlaceSummary[]; radius: number }>;
  text(query: string, bias: LatLng | null, o?: TextOpts): Promise<PlaceSummary[]>;
  autocomplete(input: string, bias: LatLng | null): Promise<Suggestion[]>;
  pick(s: Suggestion): Promise<PlaceSummary | null>;
  details(p: PlaceSummary): Promise<PlaceDetails>;
  localName(p: PlaceSummary): Promise<{ name: string; address?: string } | null>;
}
