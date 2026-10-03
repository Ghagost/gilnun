/* A small stand-in for the Google Maps JavaScript API used in end-to-end tests.
   Implements the parts 길눈 uses: Map (camera, projection, events), AdvancedMarkerElement, Circle, Polyline,
   layers, Places (New) search/details/autocomplete and Routes. Draws a plain grid so screenshots show pins. */
(() => {
  const g = window.google || (window.google = {});
  const maps = g.maps || (g.maps = {});
  const TILE = 256;
  const RAD = Math.PI / 180;

  /* ---------- fixtures (around Shinjuku Station) ---------- */
  const hours = (o, c) => ({
    periods: [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: o, minute: 0 }, close: c >= 24 ? { day: (d + 1) % 7, hour: c - 24, minute: 0 } : { day: d, hour: c, minute: 0 } })),
    weekdayDescriptions: ['월요일: ', '화요일: ', '수요일: ', '목요일: ', '금요일: ', '토요일: ', '일요일: '].map(x => `${x}${o}:00~${c >= 24 ? c - 24 : c}:00`),
  });
  const allDay = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }], weekdayDescriptions: ['월요일: 24시간 영업', '화요일: 24시간 영업', '수요일: 24시간 영업', '목요일: 24시간 영업', '금요일: 24시간 영업', '토요일: 24시간 영업', '일요일: 24시간 영업'] };
  const P = [
    { id: 'ChIJ_ichiran_shinjuku', ko: '이치란 신주쿠 중앙동구점', ja: '一蘭 新宿中央東口店', lat: 35.69085, lng: 139.70185, types: ['ramen_restaurant', 'restaurant', 'food'], primary: 'ramen_restaurant', label: '라멘 전문점', rating: 4.3, count: 8123, price: 'PRICE_LEVEL_MODERATE', hours: allDay, phone: '03-1234-0001', web: 'https://ichiran.com/', reservable: false, addrKo: '일본 〒160-0022 도쿄도 신주쿠구 신주쿠 3초메 34-11', addrJa: '日本、〒160-0022 東京都新宿区新宿３丁目３４−１１' },
    { id: 'ChIJ_fuunji', ko: '후운지', ja: '風雲児', lat: 35.68761, lng: 139.69691, types: ['ramen_restaurant', 'restaurant', 'food'], primary: 'ramen_restaurant', label: '라멘 전문점', rating: 4.4, count: 6211, price: 'PRICE_LEVEL_INEXPENSIVE', hours: hours(11, 21), phone: '03-1234-0002', reservable: false, addrKo: '도쿄도 시부야구 요요기 2초메 14-3', addrJa: '東京都渋谷区代々木２丁目１４−３' },
    { id: 'ChIJ_sushi_zanmai', ko: '스시 잔마이 신주쿠점', ja: 'すしざんまい 新宿店', lat: 35.69305, lng: 139.70235, types: ['sushi_restaurant', 'restaurant', 'food'], primary: 'sushi_restaurant', label: '초밥집', rating: 4.0, count: 2210, price: 'PRICE_LEVEL_MODERATE', hours: hours(11, 23), phone: '03-1234-0003', web: 'https://www.kiyomura.co.jp/', reservable: true, addrKo: '도쿄도 신주쿠구 가부키초 1초메 21-1', addrJa: '東京都新宿区歌舞伎町１丁目２１−１' },
    { id: 'ChIJ_famima', ko: '패밀리마트 신주쿠역 동쪽 출구점', ja: 'ファミリーマート 新宿駅東口店', lat: 35.69112, lng: 139.70104, types: ['convenience_store', 'store'], primary: 'convenience_store', label: '편의점', rating: 3.6, count: 180, hours: allDay, addrKo: '도쿄도 신주쿠구 신주쿠 3초메 38-1', addrJa: '東京都新宿区新宿３丁目３８−１' },
    { id: 'ChIJ_seven', ko: '세븐일레븐 신주쿠 3초메점', ja: 'セブン-イレブン 新宿３丁目店', lat: 35.69021, lng: 139.70392, types: ['convenience_store', 'store'], primary: 'convenience_store', label: '편의점', rating: 3.5, count: 96, hours: allDay, addrKo: '도쿄도 신주쿠구 신주쿠 3초메 22-7', addrJa: '東京都新宿区新宿３丁目２２−７' },
    { id: 'ChIJ_lawson', ko: '로손 니시신주쿠 1초메점', ja: 'ローソン 西新宿一丁目店', lat: 35.68979, lng: 139.69802, types: ['convenience_store', 'store'], primary: 'convenience_store', label: '편의점', rating: 3.4, count: 77, hours: allDay, addrKo: '도쿄도 신주쿠구 니시신주쿠 1초메 1-5', addrJa: '東京都新宿区西新宿１丁目１−５' },
    { id: 'ChIJ_shinjuku_sta', ko: '신주쿠역', ja: '新宿駅', lat: 35.68962, lng: 139.70046, types: ['train_station', 'transit_station'], primary: 'train_station', label: '기차역', rating: 3.9, count: 41000, addrKo: '도쿄도 신주쿠구 신주쿠 3초메 38-1', addrJa: '東京都新宿区新宿３丁目３８−１' },
    { id: 'ChIJ_seibu_shinjuku', ko: '세이부신주쿠역', ja: '西武新宿駅', lat: 35.69497, lng: 139.70031, types: ['train_station', 'transit_station'], primary: 'train_station', label: '기차역', rating: 3.8, count: 3100, addrKo: '도쿄도 신주쿠구 가부키초 1초메 30-1', addrJa: '東京都新宿区歌舞伎町１丁目３０−１' },
    { id: 'ChIJ_gyoen', ko: '신주쿠 교엔', ja: '新宿御苑', lat: 35.68518, lng: 139.71003, types: ['park', 'tourist_attraction'], primary: 'park', label: '공원', rating: 4.6, count: 52000, price: undefined, hours: hours(9, 18), web: 'https://www.env.go.jp/garden/shinjukugyoen/', addrKo: '도쿄도 신주쿠구 나이토마치 11', addrJa: '東京都新宿区内藤町１１' },
    { id: 'ChIJ_gracery', ko: '호텔 그레이서리 신주쿠', ja: 'ホテルグレイスリー新宿', lat: 35.69458, lng: 139.70185, types: ['hotel', 'lodging'], primary: 'hotel', label: '호텔', rating: 4.2, count: 15800, hours: undefined, phone: '03-6833-1111', web: 'https://gracery.com/shinjuku/', reservable: true, addrKo: '도쿄도 신주쿠구 가부키초 1초메 19-1', addrJa: '東京都新宿区歌舞伎町１丁目１９−１' },
    { id: 'ChIJ_blue_bottle', ko: '블루보틀 커피 신주쿠점', ja: 'ブルーボトルコーヒー 新宿カフェ', lat: 35.68798, lng: 139.70052, types: ['cafe', 'coffee_shop', 'food'], primary: 'coffee_shop', label: '커피숍', rating: 4.1, count: 1900, hours: hours(8, 21), addrKo: '도쿄도 신주쿠구 신주쿠 4초메 1-6', addrJa: '東京都新宿区新宿４丁目１−６' },
    { id: 'ChIJ_toyota_rent', ko: '토요타 렌터카 신주쿠역 남쪽 출구점', ja: 'トヨタレンタカー 新宿駅南口店', lat: 35.68703, lng: 139.69851, types: ['car_rental'], primary: 'car_rental', label: '렌터카 업체', rating: 3.9, count: 420, hours: hours(8, 22), phone: '03-5341-0100', addrKo: '도쿄도 시부야구 요요기 2초메 2-1', addrJa: '東京都渋谷区代々木２丁目２−１' },
    { id: 'ChIJ_haneda', ko: '하네다 공항', ja: '羽田空港', lat: 35.54936, lng: 139.77981, types: ['airport'], primary: 'airport', label: '공항', rating: 4.4, count: 90000, addrKo: '도쿄도 오타구 하네다 공항', addrJa: '東京都大田区羽田空港' },
  ];
  window.__FAKE_PLACES__ = P;
  const byId = new Map(P.map(p => [p.id, p]));

  const svgPhoto = (label, hue) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},55%,38%)"/></linearGradient></defs><rect width="720" height="480" fill="url(#g)"/><text x="40" y="440" font-family="sans-serif" font-size="40" fill="#fff">${label}</text></svg>`)}`;
  function fieldValue(d, f, lang) {
    const ja = lang === 'ja';
    switch (f) {
      case 'id': return d.id;
      case 'displayName': return ja ? d.ja : d.ko;
      case 'location': return new LatLng(d.lat, d.lng);
      case 'primaryType': return d.primary;
      case 'primaryTypeDisplayName': return d.label;
      case 'types': return d.types;
      case 'formattedAddress': return ja ? d.addrJa : d.addrKo;
      case 'rating': return d.rating;
      case 'userRatingCount': return d.count;
      case 'priceLevel': return d.price;
      case 'regularOpeningHours': return d.hours;
      case 'utcOffsetMinutes': return 540;
      case 'businessStatus': return 'OPERATIONAL';
      case 'photos': return [0, 1, 2].map(i => ({ getURI: () => svgPhoto(d.ko, (d.lat * 1000 + i * 70) % 360), authorAttributions: [{ displayName: '구글 사용자', uri: 'https://maps.google.com/' }] }));
      case 'googleMapsURI': return `https://maps.google.com/?cid=${encodeURIComponent(d.id)}`;
      case 'nationalPhoneNumber': return d.phone;
      case 'websiteURI': return d.web;
      case 'reviews': return [{ authorAttribution: { displayName: '여행자 A', uri: 'https://maps.google.com/' }, rating: 5, text: '줄은 길지만 금방 빠져요. 국물이 진하고 맛있어요.', originalText: '行列はすぐ進みます。スープが濃厚で美味しい。', relativePublishTimeDescription: '2주 전' }];
      case 'editorialSummary': return d.primary === 'park' ? '넓은 정원과 온실이 있는 도심 속 공원' : undefined;
      case 'reviewSummary': return d.rating >= 4.2 ? { text: { text: '리뷰 요약: 맛과 분위기가 좋다는 평이 많고, 저녁에는 대기가 길다는 의견이 있어요.' } } : undefined;
      case 'paymentOptions': return { acceptsCreditCards: d.primary !== 'ramen_restaurant', acceptsCashOnly: d.primary === 'ramen_restaurant', acceptsNFC: true };
      case 'accessibilityOptions': return { hasWheelchairAccessibleEntrance: true };
      case 'isReservable': return d.reservable;
      case 'hasTakeout': return d.types.includes('food');
      case 'servesVegetarianFood': return false;
      case 'isGoodForGroups': return true;
      default: return undefined;
    }
  }

  /* ---------- core types ---------- */
  class LatLng {
    constructor(a, b) {
      if (a && typeof a === 'object') { this._lat = typeof a.lat === 'function' ? a.lat() : a.lat; this._lng = typeof a.lng === 'function' ? a.lng() : a.lng; }
      else { this._lat = a; this._lng = b; }
    }
    lat() { return this._lat; }
    lng() { return this._lng; }
    toJSON() { return { lat: this._lat, lng: this._lng }; }
  }
  const toLL = p => (p instanceof LatLng ? { lat: p.lat(), lng: p.lng() } : { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng });
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class LatLngBounds {
    constructor() { this.s = 90; this.n = -90; this.w = 180; this.e = -180; }
    extend(p) { const q = toLL(p); this.s = Math.min(this.s, q.lat); this.n = Math.max(this.n, q.lat); this.w = Math.min(this.w, q.lng); this.e = Math.max(this.e, q.lng); return this; }
    getCenter() { return new LatLng((this.s + this.n) / 2, (this.w + this.e) / 2); }
    isEmpty() { return this.s > this.n; }
  }

  const reg = new WeakMap();
  function addListener(obj, evt, fn) {
    let m = reg.get(obj);
    if (!m) { m = {}; reg.set(obj, m); }
    (m[evt] ||= new Set()).add(fn);
    return { remove() { m[evt]?.delete(fn); } };
  }
  const event = {
    addListener,
    addListenerOnce(obj, evt, fn) { const h = addListener(obj, evt, (...a) => { h.remove(); fn(...a); }); return h; },
    removeListener(h) { h?.remove?.(); },
    clearInstanceListeners(obj) { reg.delete(obj); },
    trigger(obj, evt, ...args) { for (const fn of [...(reg.get(obj)?.[evt] || [])]) { try { fn(...args); } catch (e) { console.error(e); } } },
  };

  const project = (lat, lng) => { const s = Math.min(0.9999, Math.max(-0.9999, Math.sin(lat * RAD))); return { x: ((lng + 180) / 360) * TILE, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE }; };
  const unproject = (x, y) => { const n = Math.PI - (2 * Math.PI * y) / TILE; return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: (x / TILE) * 360 - 180 }; };

  class GMap {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts || {};
      this.center = toLL(opts.center || { lat: 35.68, lng: 139.76 });
      this.zoom = opts.zoom ?? 14;
      this.heading = 0;
      this.tilt = 0;
      this.items = new Set();
      el.innerHTML = '';
      el.style.overflow = 'hidden';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      const dark = opts.colorScheme === 'DARK' || (opts.colorScheme === 'FOLLOW_SYSTEM' && matchMedia('(prefers-color-scheme: dark)').matches);
      const bg = document.createElement('div');
      bg.className = 'fake-gmap';
      bg.setAttribute('data-fake-map', '1');
      Object.assign(bg.style, { position: 'absolute', inset: '0', background: dark ? '#1f2328' : '#e9ebe6', backgroundImage: `linear-gradient(${dark ? '#2b3036' : '#d7dbd3'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? '#2b3036' : '#d7dbd3'} 1px, transparent 1px)`, backgroundSize: '56px 56px' });
      el.appendChild(bg);
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.assign(this.svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      el.appendChild(this.svg);
      this.layer = document.createElement('div');
      Object.assign(this.layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      el.appendChild(this.layer);
      const brand = document.createElement('div');
      brand.textContent = 'Google (test)';
      Object.assign(brand.style, { position: 'absolute', left: '6px', bottom: '4px', font: '11px sans-serif', color: '#777' });
      el.appendChild(brand);
      let drag = null;
      if (this.opts.gestureHandling !== 'none') {
        bg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, c: { ...this.center }, moved: false }; bg.setPointerCapture?.(e.pointerId); });
        bg.addEventListener('pointermove', e => {
          if (!drag) return;
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; event.trigger(this, 'dragstart'); }
          if (drag.moved) {
            const s = 2 ** this.zoom; const p = project(drag.c.lat, drag.c.lng);
            this.center = unproject(p.x - dx / s, p.y - dy / s);
            this._changed();
          }
        });
        bg.addEventListener('pointerup', e => {
          const d = drag; drag = null;
          if (d && !d.moved) {
            const r = el.getBoundingClientRect();
            const ll = this._fromPixel(e.clientX - r.left, e.clientY - r.top);
            event.trigger(this, 'click', { latLng: new LatLng(ll.lat, ll.lng), stop() {} });
          }
        });
        bg.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(3, Math.min(21, this.zoom - Math.sign(e.deltaY) * 0.5)); this._changed(); }, { passive: false });
      }
      new ResizeObserver(() => this._draw()).observe(el);
      setTimeout(() => event.trigger(this, 'idle'), 0);
    }
    _w() { return this.el.clientWidth || innerWidth; }
    _h() { return this.el.clientHeight || innerHeight; }
    _toPixel(lat, lng) { const s = 2 ** this.zoom; const c = project(this.center.lat, this.center.lng); const p = project(lat, lng); return { x: (p.x - c.x) * s + this._w() / 2, y: (p.y - c.y) * s + this._h() / 2 }; }
    _fromPixel(x, y) { const s = 2 ** this.zoom; const c = project(this.center.lat, this.center.lng); return unproject(c.x + (x - this._w() / 2) / s, c.y + (y - this._h() / 2) / s); }
    _draw() { for (const it of this.items) it._draw?.(); }
    _changed() { this._draw(); clearTimeout(this._t); this._t = setTimeout(() => event.trigger(this, 'idle'), 60); }
    addListener(evt, fn) { return addListener(this, evt, fn); }
    getCenter() { return new LatLng(this.center.lat, this.center.lng); }
    setCenter(c) { this.center = toLL(c); this._changed(); }
    getZoom() { return this.zoom; }
    setZoom(z) { this.zoom = z; this._changed(); }
    getHeading() { return this.heading; }
    getTilt() { return this.tilt; }
    getDiv() { return this.el; }
    panTo(c) { this.center = toLL(c); this._changed(); }
    moveCamera(c) {
      if (c.center) this.center = toLL(c.center);
      if (c.zoom != null) this.zoom = c.zoom;
      const hc = c.heading != null && c.heading !== this.heading;
      if (c.heading != null) this.heading = c.heading;
      if (c.tilt != null) this.tilt = c.tilt;
      this._changed();
      if (hc) event.trigger(this, 'heading_changed');
    }
    fitBounds(b, pad = {}) {
      if (b.isEmpty()) return;
      const p = typeof pad === 'number' ? { top: pad, bottom: pad, left: pad, right: pad } : pad;
      const w = Math.max(40, this._w() - (p.left || 0) - (p.right || 0)), h = Math.max(40, this._h() - (p.top || 0) - (p.bottom || 0));
      const a = project(b.n, b.w), z = project(b.s, b.e);
      const dx = Math.max(1e-9, Math.abs(z.x - a.x)), dy = Math.max(1e-9, Math.abs(z.y - a.y));
      this.zoom = Math.max(3, Math.min(21, Math.log2(Math.min(w / dx, h / dy))));
      const cx = (a.x + z.x) / 2 - ((p.left || 0) - (p.right || 0)) / 2 / 2 ** this.zoom, cy = (a.y + z.y) / 2 - ((p.top || 0) - (p.bottom || 0)) / 2 / 2 ** this.zoom;
      this.center = unproject(cx, cy);
      this._changed();
    }
    getProjection() {
      return {
        fromLatLngToPoint: ll => { const q = toLL(ll); const r = project(q.lat, q.lng); return new Point(r.x, r.y); },
        fromPointToLatLng: pt => { const r = unproject(pt.x, pt.y); return new LatLng(r.lat, r.lng); },
      };
    }
  }

  class Overlay {
    get map() { return this._map || null; }
    set map(m) {
      if (this._map === m) return;
      if (this._map) { this._map.items.delete(this); this._remove(); }
      this._map = m || null;
      if (m) { m.items.add(this); this._add(); this._draw(); }
    }
    setMap(m) { this.map = m; }
    getMap() { return this.map; }
  }

  class AdvancedMarkerElement extends Overlay {
    constructor(o = {}) {
      super();
      this.wrap = document.createElement('div');
      this.wrap.className = 'fake-adv-marker';
      Object.assign(this.wrap.style, { position: 'absolute', left: '0', top: '0', transform: 'translate(-50%, -100%)', pointerEvents: 'auto' });
      this._content = o.content || document.createElement('div');
      this.wrap.appendChild(this._content);
      this._position = o.position ? toLL(o.position) : null;
      this.title = o.title || '';
      this.zIndex = o.zIndex ?? 0;
      this.gmpClickable = o.gmpClickable;
      this.wrap.addEventListener('click', e => { e.stopPropagation(); this.wrap.dispatchEvent(new CustomEvent('gmp-click-internal')); for (const fn of this._clicks || []) fn(e); });
      if (o.map) this.map = o.map;
    }
    get position() { return this._position; }
    set position(p) { this._position = p ? toLL(p) : null; this._draw(); }
    get content() { return this._content; }
    set content(c) { this.wrap.innerHTML = ''; this._content = c; if (c) this.wrap.appendChild(c); }
    get zIndex() { return this._z; }
    set zIndex(z) { this._z = z; if (this.wrap) this.wrap.style.zIndex = String(z ?? 0); }
    set title(t) { this._title = t; if (this.wrap) this.wrap.title = t || ''; }
    get title() { return this._title; }
    addEventListener(type, fn) { if (type === 'gmp-click' || type === 'click') (this._clicks ||= []).push(fn); }
    addListener(type, fn) { this.addEventListener(type, fn); return { remove() {} }; }
    _add() { this._map.layer.appendChild(this.wrap); }
    _remove() { this.wrap.remove(); }
    _draw() {
      if (!this._map || !this._position) return;
      const p = this._map._toPixel(this._position.lat, this._position.lng);
      this.wrap.style.left = `${p.x}px`;
      this.wrap.style.top = `${p.y}px`;
    }
  }

  class Circle extends Overlay {
    constructor(o = {}) { super(); this.o = { ...o }; this.el = document.createElement('div'); Object.assign(this.el.style, { position: 'absolute', borderRadius: '50%', pointerEvents: 'none' }); if (o.map) this.map = o.map; }
    setCenter(c) { this.o.center = c; this._draw(); }
    setRadius(r) { this.o.radius = r; this._draw(); }
    _add() { this._map.layer.prepend(this.el); }
    _remove() { this.el.remove(); }
    _draw() {
      if (!this._map || !this.o.center) return;
      const c = toLL(this.o.center);
      const mpp = (156543.03392 * Math.cos(c.lat * RAD)) / 2 ** this._map.zoom;
      const r = Math.max(2, (this.o.radius || 0) / mpp);
      const p = this._map._toPixel(c.lat, c.lng);
      Object.assign(this.el.style, { left: `${p.x - r}px`, top: `${p.y - r}px`, width: `${2 * r}px`, height: `${2 * r}px`, background: this.o.fillColor || '#2F6BFF', opacity: String(this.o.fillOpacity ?? 0.15) });
    }
  }

  class Polyline extends Overlay {
    constructor(o = {}) { super(); this.o = { ...o }; this.el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); if (o.map) this.map = o.map; }
    _add() { this._map.svg.appendChild(this.el); }
    _remove() { this.el.remove(); }
    _draw() {
      if (!this._map) return;
      const pts = (this.o.path || []).map(toLL).map(q => this._map._toPixel(q.lat, q.lng)).map(q => `${q.x},${q.y}`).join(' ');
      this.el.setAttribute('points', pts);
      this.el.setAttribute('fill', 'none');
      this.el.setAttribute('stroke', this.o.strokeColor || '#2F6BFF');
      this.el.setAttribute('stroke-width', String(this.o.strokeWeight || 5));
      this.el.setAttribute('stroke-linecap', 'round');
      if (this.o.icons) this.el.setAttribute('stroke-dasharray', '6 8');
    }
  }
  class TransitLayer extends Overlay { _add() {} _remove() {} _draw() {} }
  class TrafficLayer extends Overlay { _add() {} _remove() {} _draw() {} }

  /* ---------- places ---------- */
  const near = (d, c) => { const a = toLL(c); const dx = (d.lng - a.lng) * Math.cos(a.lat * RAD) * 111320, dy = (d.lat - a.lat) * 110540; return Math.hypot(dx, dy); };
  const words = s => String(s || '').toLowerCase().replace(/[・\s]+/g, ' ').trim().split(' ').filter(Boolean);
  class Place {
    constructor(o = {}) { this.id = o.id; this.requestedLanguage = o.requestedLanguage || 'ko'; }
    static _make(d, fields, lang) { const p = new Place({ id: d.id, requestedLanguage: lang }); for (const f of fields || []) { const v = fieldValue(d, f, lang); if (v !== undefined) p[f] = v; } return p; }
    static async searchNearby(req) {
      await new Promise(r => setTimeout(r, 60));
      const c = req.locationRestriction?.center || { lat: 35.69, lng: 139.70 };
      const r = req.locationRestriction?.radius || 1500;
      const types = req.includedTypes || [];
      const list = P.filter(d => (!types.length || d.types.some(t => types.includes(t))) && near(d, c) <= r).sort((a, b) => near(a, c) - near(b, c)).slice(0, req.maxResultCount || 20);
      return { places: list.map(d => Place._make(d, req.fields, req.language)) };
    }
    static async searchByText(req) {
      await new Promise(r => setTimeout(r, 60));
      const q = words(req.textQuery);
      const hit = d => { const hay = `${d.ko} ${d.ja} ${d.label} ${d.types.join(' ')} ${d.primary}`.toLowerCase(); return q.some(w => hay.includes(w)) || (q.some(w => /라멘|ラーメン|ramen/.test(w)) && d.primary === 'ramen_restaurant') || (q.some(w => /편의점|コンビニ/.test(w)) && d.primary === 'convenience_store') || (q.some(w => /맛집|식당|restaurant/.test(w)) && d.types.includes('restaurant')); };
      const c = req.locationBias?.center;
      let list = P.filter(hit);
      if (req.includedType) list = list.filter(d => d.types.includes(req.includedType));
      if (c) list.sort((a, b) => near(a, c) - near(b, c));
      return { places: list.slice(0, req.maxResultCount || 10).map(d => Place._make(d, req.fields, req.language)) };
    }
    async fetchFields({ fields }) {
      await new Promise(r => setTimeout(r, 40));
      const d = byId.get(this.id);
      if (!d) throw new Error(`NOT_FOUND: ${this.id}`);
      for (const f of fields || []) { const v = fieldValue(d, f, this.requestedLanguage); if (v !== undefined) this[f] = v; }
      return { place: this };
    }
  }
  class AutocompleteSessionToken {}
  const AutocompleteSuggestion = {
    async fetchAutocompleteSuggestions(req) {
      const q = words(req.input);
      const list = P.filter(d => q.length && q.every(w => `${d.ko} ${d.ja}`.toLowerCase().includes(w))).slice(0, 5);
      const origin = req.origin;
      return {
        suggestions: [
          ...list.map(d => ({ placePrediction: { placeId: d.id, text: { text: d.ko }, mainText: { text: d.ko, matches: [{ startOffset: 0, endOffset: Math.min(d.ko.length, req.input.length) }] }, secondaryText: { text: d.addrKo }, types: d.types, distanceMeters: origin ? Math.round(near(d, origin)) : undefined, toPlace: () => new Place({ id: d.id, requestedLanguage: req.language }) } })),
          { queryPrediction: { text: { text: `${req.input} 맛집` } } },
        ],
      };
    },
  };

  /* ---------- routes ---------- */
  const Route = {
    async computeRoutes(req) {
      const a = toLL(req.origin), b = toLL(req.destination);
      const m = near(b, a);
      const walk = req.travelMode === 'WALKING';
      const mid = { lat: (a.lat + b.lat) / 2 + 0.0008, lng: (a.lng + b.lng) / 2 - 0.0006 };
      return { routes: [{ durationMillis: Math.round((walk ? m * 1.25 / 80 : m * 1.35 / 1000 / 25 * 60 + 3) * 60000), distanceMeters: Math.round(m * (walk ? 1.25 : 1.35)), path: [a, mid, b].map(p => new LatLng(p.lat, p.lng)), legs: [{ steps: [{ navigationInstruction: { instructions: '북동쪽으로 출발' } }, { navigationInstruction: { instructions: '오른쪽으로 돌기' } }] }] }] };
    },
  };

  Object.assign(maps, {
    version: 'fake-3.62',
    LatLng, Point, LatLngBounds, event, Map: GMap, Circle, Polyline, TransitLayer, TrafficLayer,
    ColorScheme: { DARK: 'DARK', LIGHT: 'LIGHT', FOLLOW_SYSTEM: 'FOLLOW_SYSTEM' },
    RenderingType: { VECTOR: 'VECTOR', RASTER: 'RASTER', UNINITIALIZED: 'UNINITIALIZED' },
    marker: { AdvancedMarkerElement },
    places: { Place, AutocompleteSessionToken, AutocompleteSuggestion, SearchNearbyRankPreference: { DISTANCE: 'DISTANCE', POPULARITY: 'POPULARITY' } },
    routes: { Route },
  });
  const libs = { core: maps, maps, marker: maps.marker, places: maps.places, routes: maps.routes, geometry: {} };
  maps.importLibrary = async name => libs[name] || {};
  if (typeof maps.__ib__ === 'function') maps.__ib__();
})();
