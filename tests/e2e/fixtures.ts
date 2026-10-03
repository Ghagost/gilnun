import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Page, type WebSocketRoute } from '@playwright/test';

const FAKE_GMAPS = fs.readFileSync(path.join(process.cwd(), 'tests/e2e/fake-gmaps.js'), 'utf8');

export const SHINJUKU = { lat: 35.6905, lng: 139.7004 };

const STYLE = (dark: boolean) => JSON.stringify({ version: 8, name: 'test', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#22262b' : '#e6ebe3' } }] });

const OVERPASS = {
  elements: [
    { type: 'node', id: 101, lat: 35.69112, lon: 139.70104, tags: { name: 'ファミリーマート 新宿駅東口店', 'name:ko': '패밀리마트 신주쿠역 동쪽 출구점', shop: 'convenience', brand: 'ファミリーマート', opening_hours: '24/7' } },
    { type: 'node', id: 102, lat: 35.69021, lon: 139.70392, tags: { name: 'セブン-イレブン 新宿3丁目店', shop: 'convenience', opening_hours: '24/7' } },
    { type: 'node', id: 103, lat: 35.68979, lon: 139.69802, tags: { name: 'ローソン 西新宿一丁目店', shop: 'convenience', opening_hours: 'Mo-Su 07:00-23:00' } },
  ],
};

export type Opts = { onboarded?: boolean; settings?: Record<string, unknown>; freeMap?: boolean; dark?: boolean };

/** Routes every third-party request to fakes; nothing leaves the test machine. */
export async function prepare(page: Page, o: Opts = {}) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort('blockedbyclient'));
  await page.route(/^https:\/\/maps\.googleapis\.com\/maps\/api\/js/, r => r.fulfill({ contentType: 'application/javascript', body: FAKE_GMAPS }));
  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/styles/')) return r.fulfill({ contentType: 'application/json', body: STYLE(u.pathname.includes('dark')) });
    return r.fulfill({ status: 204, body: '' });
  });
  await page.route(/overpass/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(OVERPASS) }));
  await page.route(/^https:\/\/nominatim\.openstreetmap\.org\/reverse/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ address: { city: '新宿区', suburb: '新宿', country_code: 'jp' } }) }));
  await page.route(/^https:\/\/nominatim\.openstreetmap\.org\/search/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ osm_type: 'node', osm_id: 9, lat: '35.6896', lon: '139.7006', name: '新宿駅', display_name: '新宿駅, 新宿区, 東京都', category: 'railway', type: 'station', namedetails: { name: '新宿駅', 'name:ko': '신주쿠역' } }]) }));
  await page.route(/^https:\/\/photon\.komoot\.io\//, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [{ geometry: { coordinates: [139.7006, 35.6896] }, properties: { osm_type: 'N', osm_id: 9, name: '新宿駅', osm_key: 'railway', osm_value: 'station', city: '新宿区' } }] }) }));
  const settings = {
    onboarded: o.onboarded ?? true, deviceId: 'd_e2e_device_0001', voice: false,
    ...(o.freeMap ? { forceFreeMap: true } : {}), ...(o.dark ? { theme: 'dark' } : {}), ...(o.settings || {}),
  };
  await page.addInitScript(s => {
    if (!localStorage.getItem('gilnun.settings')) localStorage.setItem('gilnun.settings', JSON.stringify({ state: s, version: 2 }));
    // No real speech engine in headless Chromium.
    if ('speechSynthesis' in window) { try { window.speechSynthesis.speak = () => {}; } catch { /* ignore */ } }
  }, settings);
}

export type LiveMock = { setup: Record<string, unknown> | null; received: Record<string, unknown>[] };

/** Gemini Live WebSocket stand-in: setupComplete, a spoken greeting, tool calls for "편의점". */
export async function mockGeminiLive(page: Page): Promise<LiveMock> {
  const state: LiveMock = { setup: null, received: [] };
  const pcm = Buffer.alloc(4800).toString('base64'); // 0.1 s of silence at 24 kHz
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws: WebSocketRoute) => {
    const out = (m: unknown) => ws.send(Buffer.from(JSON.stringify(m)));
    ws.onMessage(raw => {
      let m: Record<string, any>;
      try { m = JSON.parse(String(raw)); } catch { return; }
      state.received.push(m);
      if (m.setup) { state.setup = m.setup; out({ setupComplete: {} }); out({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } }); return; }
      const text: string | undefined = m.realtimeInput?.text;
      if (text && /편의점/.test(text)) { out({ toolCall: { functionCalls: [{ id: 'fc1', name: 'search_places', args: { category: 'conv' } }] } }); return; }
      if (text) {
        out({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm } }] } } });
        out({ serverContent: { outputTranscription: { text: '안녕하세요! 앞에 보이는 ' } } });
        out({ serverContent: { outputTranscription: { text: '노란 東口 표지판 쪽으로 가세요.' } } });
        out({ serverContent: { turnComplete: true } });
        return;
      }
      if (m.toolResponse) {
        const r = m.toolResponse.functionResponses?.[0]?.response;
        const first = r?.places?.[0] || r?.results?.[0];
        out({ serverContent: { outputTranscription: { text: `가장 가까운 곳은 ${first?.name || '편의점'}이에요.` } } });
        out({ serverContent: { turnComplete: true } });
      }
    });
  });
  return state;
}

/** `page` that fails the test on any uncaught exception in the app. */
export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
    await use(errors);
    expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function openApp(page: Page, o: Opts = {}, url = '/') {
  await prepare(page, o);
  await page.goto(url);
  await expect(page.locator('.tabbar')).toBeVisible();
  if (o.freeMap) await expect(page.locator('.maplibregl-canvas, .maplibregl-map').first()).toBeVisible();
  else await expect(page.locator('[data-fake-map]')).toBeVisible();
}

/** Opens a place sheet by searching for it from the top bar. */
export async function searchAndOpen(page: Page, query: string, name: RegExp | string) {
  await page.getByRole('button', { name: '장소 검색 열기' }).click();
  await page.getByRole('textbox', { name: '검색어' }).fill(query);
  await page.getByRole('textbox', { name: '검색어' }).press('Enter');
  // A single hit opens the place directly; otherwise pick it from the list.
  const title = page.locator('.p-name');
  const row = (typeof name === 'string' ? page.locator('.result').filter({ has: page.getByText(name, { exact: true }) }) : page.locator('.result', { hasText: name })).first();
  await expect(title.or(row).first()).toBeVisible();
  if (!(await title.isVisible())) await row.click();
  await expect(title).toContainText(name);
}
