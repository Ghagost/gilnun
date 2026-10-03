/* 길눈 service worker: offline app shell + hashed static files + free-map tiles.
   Never caches our API, AI providers or Google Maps (their terms and their own caching apply). */
const VERSION = 'gilnun-2.0.0';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const TILES = 'gilnun-tiles-1';
const TILE_LIMIT = 800;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.ico', '/fonts/pretendard/pretendard.css'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(SHELL_URLS.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, STATIC, TILES]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const d = event.data;
  if (d === 'skipWaiting') { self.skipWaiting(); return; }
  if (d && d.type === 'cache-urls' && Array.isArray(d.urls)) {
    event.waitUntil(caches.open(STATIC).then(async c => {
      for (const u of d.urls.slice(0, 300)) {
        try {
          const url = new URL(u);
          if (url.origin !== self.location.origin || !/^\/(_next\/static|fonts)\//.test(url.pathname)) continue;
          if (!(await c.match(u))) await c.add(u);
        } catch { /* skip */ }
      }
    }));
  }
});

async function networkFirstPage(event) {
  const req = event.request;
  try {
    const pre = await event.preloadResponse;
    const res = pre || await fetch(req);
    if (res.ok && new URL(req.url).pathname === '/') {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put('/', copy)).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match('/', { cacheName: SHELL }) || await caches.match(req);
    return cached || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>길눈</title><body style="font-family:sans-serif;padding:24px">인터넷에 연결되면 다시 열어 주세요.</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req, name) {
  const hit = await caches.match(req, { cacheName: name });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) { const copy = res.clone(); caches.open(name).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const update = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
  return hit || (await update) || Response.error();
}

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(TILES);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - TILE_LIMIT; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}

async function tiles(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) { cache.put(req, res.clone()).then(trimTiles).catch(() => {}); }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    if (req.mode === 'navigate') { event.respondWith(networkFirstPage(event)); return; }
    if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')) { event.respondWith(cacheFirst(req, STATIC)); return; }
    if (/\.(png|ico|svg|webmanifest)$/.test(url.pathname)) { event.respondWith(staleWhileRevalidate(req, STATIC)); return; }
    return;
  }
  // Free map (OpenFreeMap): keep recently seen tiles, glyphs and styles for patchy connections.
  // Styles and TileJSON change when OpenFreeMap publishes new data, so refresh those in the background.
  if (url.hostname === 'tiles.openfreemap.org') {
    const meta = url.pathname.startsWith('/styles/') || /^\/[a-z]+\/?$/.test(url.pathname);
    event.respondWith(meta ? staleWhileRevalidate(req, TILES) : tiles(req));
  }
});
