import type { CategoryKey } from './categories';
import type { HoursPeriod } from './hours';

export type AiProvider = 'openai' | 'anthropic' | 'gemini';

export type PhotoRef = {
  /** Returns an image URL at the requested max width. */
  url: (maxWidth: number) => string;
  author?: string;
  authorUri?: string;
};

export type PlaceSource = 'google' | 'osm' | 'geo' | 'custom' | 'grounding';

export type PlaceSummary = {
  /** Stable app id: "g:<googlePlaceId>", "o:n123", "geo:…", "c:…" */
  id: string;
  source: PlaceSource;
  placeId?: string;
  name: string;
  /** Japanese/local name when it differs from `name`. */
  nameLocal?: string;
  lat: number;
  lng: number;
  category: CategoryKey;
  typeLabel?: string;
  info?: string;
  address?: string;
  rating?: number;
  ratingCount?: number;
  /** 0 (free) … 4 (very expensive) */
  priceLevel?: number;
  priceText?: string;
  hours?: HoursPeriod[];
  hoursRaw?: string;
  utcOffset?: number;
  businessStatus?: string;
  photo?: PhotoRef | null;
  /** Straight-line metres from the search centre / user. */
  distance?: number;
  reservable?: boolean;
  googleMapsUri?: string;
  phone?: string;
  website?: string;
  note?: string;
};

export type Review = {
  author: string;
  authorUri?: string;
  authorPhoto?: string;
  rating?: number;
  text: string;
  original?: string;
  lang?: string;
  when?: string;
};

export type PlaceDetails = PlaceSummary & {
  photos?: PhotoRef[];
  weekdayText?: string[];
  reviews?: Review[];
  reviewSummary?: string;
  editorial?: string;
  payment?: { card?: boolean; cashOnly?: boolean; nfc?: boolean; debit?: boolean };
  access?: { entrance?: boolean; restroom?: boolean; seating?: boolean; parking?: boolean };
  dining?: { dineIn?: boolean; takeout?: boolean; delivery?: boolean; vegetarian?: boolean; breakfast?: boolean; lunch?: boolean; dinner?: boolean; beer?: boolean; wine?: boolean; groups?: boolean; kids?: boolean };
  attributions?: { name: string; uri?: string }[];
  fetchedAt: number;
};

/** A place the user keeps (saved list, itinerary stop, reservation, destination). */
export type SavedPlace = {
  id: string;
  placeId?: string;
  name: string;
  nameLocal?: string;
  lat: number;
  lng: number;
  category: CategoryKey;
  address?: string;
};

export type SavedEntry = SavedPlace & { lists: string[]; note?: string; savedAt: number };
export type SavedList = { id: string; name: string; emoji: string };

export type TripStop = {
  id: string;
  place: SavedPlace;
  /** "HH:MM" (JST) */
  time?: string;
  durationMin?: number;
  note?: string;
  done?: boolean;
};
export type TripDay = { date: string; stops: TripStop[]; note?: string };
export type Trip = {
  id: string;
  title: string;
  city?: string;
  start: string;
  end: string;
  days: TripDay[];
  createdAt: number;
  updatedAt: number;
};

export type ReservationKind = 'restaurant' | 'hotel' | 'activity' | 'transport' | 'rental' | 'other';
export type Reservation = {
  id: string;
  kind: ReservationKind;
  title: string;
  place?: SavedPlace;
  /** "YYYY-MM-DD" JST */
  date: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  people?: number;
  confirmation?: string;
  platform?: string;
  price?: string;
  note?: string;
  photoIds?: string[];
  status: 'booked' | 'pending' | 'cancelled';
  createdAt: number;
  updatedAt: number;
};

export type Source = { url: string; title?: string };

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: { mime: string; b64: string } | null;
  steps?: string[];
  refs?: string[];
  sources?: Source[];
  /** Google Maps sources that must follow grounded output. */
  mapsSources?: Source[];
  error?: string;
  provider?: AiProvider;
  model?: string;
  pending?: boolean;
  createdAt: number;
};

export type RouteLine = { id: string; points: { lat: number; lng: number }[]; color: string; width?: number; dashed?: boolean };

export type TransitLeg = {
  kind: 'walk' | 'train' | 'subway' | 'shinkansen' | 'bus' | 'flight' | 'ferry' | 'other';
  line?: string;
  color?: string;
  company?: string;
  direction?: string;
  from: string;
  to: string;
  fromTime?: string;
  toTime?: string;
  minutes: number;
  distance?: number;
  stops?: number;
  platformFrom?: string;
  platformTo?: string;
  exitTo?: string;
  numberingFrom?: string;
  numberingTo?: string;
};
export type TransitRoute = {
  minutes: number;
  departure?: string;
  arrival?: string;
  transfers: number;
  fareIc?: number;
  fareTicket?: number;
  distance?: number;
  legs: TransitLeg[];
  path?: { lat: number; lng: number }[];
};
