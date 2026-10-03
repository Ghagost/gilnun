import type { CSSProperties } from 'react';

/** 24px line icons, 2px stroke. One sprite, referenced by <I name="…" />. */
const PATHS: Record<string, string> = {
  train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8.5 13h.01M15.5 13h.01M9 16l-1.6 4.5M15 16l1.6 4.5M7.8 18.5h8.4"/>',
  exit: '<path d="M13 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7M15 8l4 4-4 4M19 12H9"/>',
  bus: '<rect x="4" y="3" width="16" height="14" rx="2.5"/><path d="M4 10h16M7 17v3M17 17v3M7.5 13.5h.01M16.5 13.5h.01"/>',
  food: '<path d="M3 11h18a9 9 0 0 1-18 0zM14.5 3L12 11M20 4l-6 7"/>',
  cafe: '<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h1.5a2.5 2.5 0 0 1 0 5H16M7.5 3v2M11.5 3v2M4 21h12"/>',
  bed: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-8v6"/><circle cx="6.5" cy="11.5" r="1.6"/>',
  torii: '<path d="M3 5.5c6 1.6 12 1.6 18 0M5 9.5h14M7 7v14M17 7v14M12 7.3v2.2"/>',
  plane: '<path d="M12 2.5c.8 0 1.5.7 1.5 1.5v6.5l7.5 4.5v2l-7.5-2.3v4.3l2 1.5v1.5l-3.5-1-3.5 1V21l2-1.5v-4.3L3 17.5v-2l7.5-4.5V4c0-.8.7-1.5 1.5-1.5z"/>',
  store: '<path d="M4 9l1.2-5h13.6L20 9M4 9h16v11H4zM10 20v-5h4v5"/>',
  bag: '<path d="M5 8h14l-1 13H6zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  car: '<path d="M5 15l1.6-5a2 2 0 0 1 1.9-1.4h7a2 2 0 0 1 1.9 1.4L19 15M3.5 15h17v3.5h-17zM6.5 18.5V21M17.5 18.5V21M7 16.8h.01M17 16.8h.01"/>',
  atm: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 8.5l3 3.5 3-3.5M12 12v4.5M9.5 13.5h5M9.5 15.5h5"/>',
  locker: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M12 3v18M9.5 10v2M14.5 10v2"/>',
  toilet: '<circle cx="7.5" cy="4.8" r="1.6"/><circle cx="16.5" cy="4.8" r="1.6"/><path d="M5.5 9h4v6.5h-1V21h-2v-5.5h-1zM16.5 8.5L14 15.5h5zM15.5 15.5V21M17.5 15.5V21"/>',
  pharmacy: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  exchange: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  cross: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7.5v9M7.5 12h9"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  pin: '<path d="M12 21s7-6 7-11.5a7 7 0 0 0-14 0C5 15 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M12 5.5l2.6 6.5h-5.2z" fill="currentColor"/><path d="M9.4 12h5.2L12 18.5z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  micoff: '<path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11a6.5 6.5 0 0 1-.5 2.5M12 17.5V21M3 3l18 18"/>',
  send: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  ai: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  dir: '<path d="M12 2.5l7.5 9.5H15v9.5H9V12H4.5z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.5-6 2.5 2.5V21M7.5 12l2.5-4h3l2.5 3.5H18M12.5 8l-1.3 7"/>',
  big: '<path d="M3.5 18L8.5 6l5 12M5.3 14h6.4M14.5 18l3-7.5 3 7.5M15.3 16h4.4"/>',
  auto: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  map: '<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5zM9 4v13M15 6.5v13"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h3"/>',
  ticket: '<path d="M4 7.5V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 0 0 5V14a2.5 2.5 0 0 0 0 4v.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V18a2.5 2.5 0 0 0 0-4v-1.5a2.5 2.5 0 0 0 0-5z"/><path d="M14 5v14" stroke-dasharray="2 2.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5"/>',
  bookmark: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 14a5.5 5.5 0 0 1 3 6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  traffic: '<rect x="8" y="2.5" width="8" height="19" rx="3"/><circle cx="12" cy="7" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="17" r="1.4"/>',
  rail: '<path d="M7 3l-3 18M17 3l3 18M5.5 8h13M5 13h14M4.3 18h15.4"/>',
  taxi: '<path d="M5 15l1.6-5a2 2 0 0 1 1.9-1.4h7a2 2 0 0 1 1.9 1.4L19 15M3.5 15h17v3.5h-17zM6.5 18.5V21M17.5 18.5V21M10 8.6V6h4v2.6"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  flash: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  translate: '<path d="M4 5h9M8.5 3v2M11 5c-.8 4.5-3.5 7.5-7 9M6 9c1.2 2.2 3 3.8 5 4.8M13.5 21l4-9 4 9M15 18h5"/>',
  yen: '<path d="M6 4l6 8 6-8M12 12v8M7.5 13h9M7.5 16.5h9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15zM8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
  snow: '<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14zM8 18h.01M12 19h.01M16 18h.01M10 21h.01M14 21h.01"/>',
  storm: '<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14zM12.5 14l-2 4h3l-2 4"/>',
  fog: '<path d="M7 12h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 3.5 4.3 4.3 0 0 0 7 12zM4 16h16M6 20h12"/>',
  quake: '<path d="M2 12h3l2-5 3 10 3-12 3 9 2-2h4"/>',
  sos: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  wheelchair: '<circle cx="11" cy="4.5" r="1.7"/><path d="M11 8v6h5l2 5M11 11h5M8.5 10.5a5.5 5.5 0 1 0 6.8 7.6"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7"/>',
  home: '<path d="M4 11l8-6.5 8 6.5M6 9.5V20h12V9.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  wifioff: '<path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.3-2.4M19 12.5a10 10 0 0 0-3-1.9M2 9a14 14 0 0 1 4.5-2.8M22 9A14 14 0 0 0 11 5.1M12 20h.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  sparkle: '<path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2-2.2 6.3-2.2-6.3L3.5 11l6.3-2.2z"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.5 4.5 0 0 1 12 7.2 4.5 4.5 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/>',
  wallet: '<path d="M4 7.5V18a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12v4M16.5 14.5h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  flip: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3M6 10v4"/>',
};

export const ICON_NAMES = Object.keys(PATHS);

export function IconSprite() {
  const defs = Object.entries(PATHS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('');
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: `<defs>${defs}</defs>` }} />;
}

export function I({ name, className = '', style, title }: { name: string; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <svg className={`ic ${className}`} style={style} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <use href={`#i-${PATHS[name] ? name : 'pin'}`} />
    </svg>
  );
}

/** Raw SVG markup for DOM-built map markers. */
export function iconSvg(name: string, cls = 'ic'): string {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${PATHS[name] ? name : 'pin'}"/></svg>`;
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22.5s8-6.6 8-13a8 8 0 0 0-16 0c0 6.4 8 13 8 13z" fill="#111214" />
      <path d="M6.6 9.6c1.6-2.2 3.4-3.3 5.4-3.3s3.8 1.1 5.4 3.3c-1.6 2.2-3.4 3.3-5.4 3.3s-3.8-1.1-5.4-3.3z" fill="#FFD21F" />
      <circle cx="12" cy="9.6" r="1.9" fill="#111214" />
    </svg>
  );
}
