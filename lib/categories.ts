export type CategoryKey =
  | 'station' | 'exit' | 'bus' | 'food' | 'cafe' | 'hotel' | 'sight' | 'airport' | 'conv'
  | 'shop' | 'rental' | 'atm' | 'locker' | 'toilet' | 'pharmacy' | 'exchange' | 'hospital' | 'police' | 'place';

export type Category = {
  key: CategoryKey;
  label: string;
  color: string;
  icon: string;
  /** Google Places (New) Table A types for Nearby Search. */
  gTypes?: string[];
  /** Fallback Google text query (Japanese works best in Japan). */
  gText?: string;
  /** Distance ladder for OSM searches (metres). */
  ladder: number[];
  /** OSM Overpass body builder for an `(around:…)` filter. */
  osm?: (a: string) => string;
  /** Keep OSM features without a name (exits, ATMs…). */
  unnamedOk?: boolean;
  /** Japanese term for the Google Maps "search here" hand-off. */
  ja: string;
  /** Data source to prefer even in Google mode (Google has no type for it). */
  osmOnly?: boolean;
  /** Shown in the main chip row. */
  chip?: boolean;
};

export const CATEGORIES: Category[] = [
  { key: 'station', label: '역', color: '#0B5FB0', icon: 'train', chip: true, ja: '駅', gTypes: ['train_station', 'subway_station', 'light_rail_station'], ladder: [600, 1500, 3000],
    osm: a => `nwr["railway"="station"]${a};nwr["railway"="halt"]${a};` },
  { key: 'exit', label: '출구', color: '#0E7FA8', icon: 'exit', chip: true, ja: '駅 出口', osmOnly: true, unnamedOk: true, ladder: [250, 600, 1000],
    osm: a => `node["railway"="subway_entrance"]${a};node["railway"="train_station_entrance"]${a};` },
  { key: 'food', label: '식당', color: '#E0531B', icon: 'food', chip: true, ja: 'レストラン', gTypes: ['restaurant'], ladder: [300, 700, 1500],
    osm: a => `nwr["amenity"~"^(restaurant|fast_food|food_court)$"]${a};` },
  { key: 'cafe', label: '카페', color: '#8A5A2B', icon: 'cafe', chip: true, ja: 'カフェ', gTypes: ['cafe', 'coffee_shop'], ladder: [300, 700, 1500],
    osm: a => `nwr["amenity"="cafe"]${a};` },
  { key: 'conv', label: '편의점', color: '#0E9C88', icon: 'store', chip: true, ja: 'コンビニ', gTypes: ['convenience_store'], ladder: [300, 800, 1500],
    osm: a => `nwr["shop"="convenience"]${a};` },
  { key: 'sight', label: '관광지', color: '#C63B2B', icon: 'torii', chip: true, ja: '観光スポット',
    gTypes: ['tourist_attraction', 'museum', 'art_gallery', 'historical_landmark', 'observation_deck', 'shinto_shrine', 'buddhist_temple'], ladder: [800, 2000, 5000],
    osm: a => `nwr["tourism"~"^(attraction|museum|viewpoint|gallery|theme_park|zoo|aquarium)$"]["name"]${a};nwr["historic"~"^(castle|monument|memorial|ruins)$"]["name"]${a};nwr["amenity"="place_of_worship"]["name"]["religion"~"^(shinto|buddhist)$"]${a};` },
  { key: 'hotel', label: '숙소', color: '#6E46C6', icon: 'bed', chip: true, ja: 'ホテル', gTypes: ['lodging'], ladder: [500, 1500, 3000],
    osm: a => `nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"]${a};` },
  { key: 'bus', label: '버스', color: '#178A4A', icon: 'bus', chip: true, ja: 'バス停', gTypes: ['bus_stop', 'bus_station'], ladder: [300, 700, 1200],
    osm: a => `node["highway"="bus_stop"]${a};nwr["amenity"="bus_station"]${a};` },
  { key: 'shop', label: '쇼핑', color: '#C21D62', icon: 'bag', chip: true, ja: 'ショッピングモール', gTypes: ['shopping_mall', 'department_store'], ladder: [600, 1500, 3000],
    osm: a => `nwr["shop"~"^(mall|department_store|variety_store)$"]${a};` },
  { key: 'pharmacy', label: '약국', color: '#2B7A3D', icon: 'pharmacy', chip: true, ja: 'ドラッグストア', gTypes: ['drugstore', 'pharmacy'], ladder: [400, 1000, 2000],
    osm: a => `nwr["amenity"="pharmacy"]${a};nwr["shop"="chemist"]${a};` },
  { key: 'locker', label: '코인로커', color: '#6B4F3A', icon: 'locker', chip: true, ja: 'コインロッカー', gText: 'コインロッカー', unnamedOk: true, ladder: [300, 800, 1500],
    osm: a => `nwr["amenity"~"^(locker|luggage_locker)$"]${a};` },
  { key: 'atm', label: 'ATM', color: '#8A6A00', icon: 'atm', chip: true, ja: 'ATM', gTypes: ['atm'], unnamedOk: true, ladder: [300, 800, 1500],
    osm: a => `nwr["amenity"="atm"]${a};` },
  { key: 'toilet', label: '화장실', color: '#4E6470', icon: 'toilet', chip: true, ja: 'トイレ', gTypes: ['public_bathroom'], unnamedOk: true, ladder: [250, 600, 1200],
    osm: a => `nwr["amenity"="toilets"]${a};` },
  { key: 'rental', label: '렌터카', color: '#3A4A55', icon: 'car', chip: true, ja: 'レンタカー', gTypes: ['car_rental'], ladder: [1500, 4000, 10000],
    osm: a => `nwr["amenity"="car_rental"]${a};` },
  { key: 'airport', label: '공항', color: '#0D7488', icon: 'plane', chip: true, ja: '空港', gTypes: ['international_airport', 'airport'], ladder: [60000, 150000],
    osm: a => `nwr["aeroway"="aerodrome"]["iata"]${a};` },
  { key: 'exchange', label: '환전', color: '#5B3FA0', icon: 'exchange', chip: true, ja: '両替所', gText: '両替所', unnamedOk: true, ladder: [800, 2000, 4000],
    osm: a => `nwr["amenity"="bureau_de_change"]${a};` },
  { key: 'hospital', label: '병원', color: '#C2372D', icon: 'cross', ja: '病院', gTypes: ['hospital'], ladder: [1000, 3000, 6000],
    osm: a => `nwr["amenity"="hospital"]${a};nwr["amenity"="clinic"]${a};` },
  { key: 'police', label: '경찰·파출소', color: '#244A8F', icon: 'shield', ja: '交番', gTypes: ['police'], unnamedOk: true, ladder: [500, 1500, 3000],
    osm: a => `nwr["amenity"="police"]${a};` },
];

export const PLACE_CATEGORY: Category = { key: 'place', label: '장소', color: '#4A525B', icon: 'pin', ladder: [1000], ja: '' };

const BY_KEY = new Map(CATEGORIES.map(c => [c.key, c]));
export function category(key: string | null | undefined): Category {
  return (key && BY_KEY.get(key as CategoryKey)) || PLACE_CATEGORY;
}
export const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

/** Food sub-filters available as Google Table A types. */
export const FOOD_KINDS: { key: string; label: string; gType: string; osmCuisine: string }[] = [
  { key: 'ramen', label: '라멘', gType: 'ramen_restaurant', osmCuisine: 'ramen' },
  { key: 'sushi', label: '스시', gType: 'sushi_restaurant', osmCuisine: 'sushi' },
  { key: 'izakaya', label: '이자카야', gType: 'japanese_izakaya_restaurant', osmCuisine: 'izakaya' },
  { key: 'yakiniku', label: '야키니쿠', gType: 'yakiniku_restaurant', osmCuisine: 'yakiniku' },
  { key: 'tonkatsu', label: '돈카츠', gType: 'tonkatsu_restaurant', osmCuisine: 'tonkatsu' },
  { key: 'curry', label: '카레', gType: 'japanese_curry_restaurant', osmCuisine: 'curry' },
];

/** Maps a Google primary type to our category. */
export function categoryFromGoogleType(primary?: string | null, types?: string[] | null): CategoryKey {
  const all = [primary, ...(types || [])].filter(Boolean) as string[];
  for (const t of all) {
    if (/(^|_)(train|subway|light_rail)_station$|^transit_station$/.test(t)) return 'station';
    if (/^bus_(stop|station)$/.test(t)) return 'bus';
    if (/airport$/.test(t)) return 'airport';
    if (/^(cafe|coffee_shop|tea_house)$/.test(t)) return 'cafe';
    if (/restaurant$|^(food_court|meal_takeaway|bar|bakery)$/.test(t)) return 'food';
    if (/^(lodging|hotel|hostel|japanese_inn|motel|resort_hotel|bed_and_breakfast|guest_house)$/.test(t)) return 'hotel';
    if (/^convenience_store$/.test(t)) return 'conv';
    if (/^(shopping_mall|department_store|discount_store|store|clothing_store|electronics_store|gift_shop)$/.test(t)) return 'shop';
    if (/^car_rental$/.test(t)) return 'rental';
    if (/^atm$/.test(t)) return 'atm';
    if (/^(pharmacy|drugstore)$/.test(t)) return 'pharmacy';
    if (/^public_bathroom$/.test(t)) return 'toilet';
    if (/^(hospital|doctor|medical_clinic)$/.test(t)) return 'hospital';
    if (/^police$/.test(t)) return 'police';
    if (/^(tourist_attraction|museum|art_gallery|historical_landmark|observation_deck|shinto_shrine|buddhist_temple|park|zoo|aquarium|amusement_park|castle|monument)$/.test(t)) return 'sight';
  }
  return 'place';
}

export const CUISINE_KO: Record<string, string> = {
  ramen: '라멘', sushi: '스시', udon: '우동', soba: '소바', yakiniku: '야키니쿠', curry: '카레', tonkatsu: '돈카츠', beef_bowl: '규동',
  gyudon: '규동', okonomiyaki: '오코노미야키', takoyaki: '타코야키', tempura: '덴푸라', izakaya: '이자카야', japanese: '일식', chinese: '중식',
  korean: '한식', italian: '이탈리안', french: '프렌치', pizza: '피자', burger: '버거', coffee_shop: '커피', noodle: '면', yakitori: '야키토리',
  kaiseki: '가이세키', unagi: '장어', bakery: '베이커리', cake: '케이크', chicken: '치킨', fried_chicken: '치킨', steak: '스테이크', seafood: '해산물',
  teishoku: '정식', dessert: '디저트', sandwich: '샌드위치', thai: '태국', indian: '인도', vietnamese: '베트남', ice_cream: '아이스크림',
  shabu_shabu: '샤부샤부', sukiyaki: '스키야키', gyoza: '교자', kushikatsu: '쿠시카츠', monjayaki: '몬자야키', crepe: '크레페', tea: '차',
};
export function cuisineKo(c?: string | null): string {
  if (!c) return '';
  const parts = String(c).split(/[;,]/).map(s => s.trim().toLowerCase().replace(/-/g, '_'));
  return [...new Set(parts.map(p => CUISINE_KO[p]).filter(Boolean))].join('·');
}
