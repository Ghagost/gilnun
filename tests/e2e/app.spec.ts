import zlib from 'node:zlib';
import { expect, mockGeminiLive, openApp, prepare, searchAndOpen, test } from './fixtures';

test.describe('boot', () => {
  test('opens on the Google map with location, weather and the tab bar', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.fake-adv-marker')).toHaveCount(1, { timeout: 15000 }); // the blue "me" dot
    await expect(page.getByRole('button', { name: '장소 검색 열기' })).toBeVisible();
    for (const t of ['지도', '일정', 'AI', '예약', '도구']) await expect(page.locator('.tabbar').getByText(t, { exact: true })).toBeVisible();
    await expect(page.locator('.chips').getByRole('button', { name: '편의점' })).toBeVisible();
  });

  test('first run shows onboarding and remembers it', async ({ page }) => {
    await openApp(page, { onboarded: false });
    await expect(page.getByRole('dialog', { name: '길눈 시작하기' })).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.locator('.tone-open', { hasText: '켜짐' }).first()).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByRole('heading', { name: 'AI 고르기' })).toBeVisible();
    await expect(page.getByText('바로 쓸 수 있어요')).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();
    await page.getByRole('button', { name: '시작하기' }).click();
    await expect(page.getByRole('dialog', { name: '길눈 시작하기' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.getByRole('dialog', { name: '길눈 시작하기' })).toHaveCount(0);
  });
});

test.describe('map & places', () => {
  test('category chip lists nearby convenience stores, nearest first', async ({ page }) => {
    await openApp(page);
    await page.locator('.chips').getByRole('button', { name: '편의점' }).click();
    const rows = page.locator('.result');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('패밀리마트');
    await expect(page.locator('.fake-adv-marker')).toHaveCount(4); // 3 pins + me
  });

  test('place sheet shows Google details, hours, Japanese name and booking', async ({ page }) => {
    await openApp(page);
    await searchAndOpen(page, '스시', /스시 잔마이/);
    await page.getByRole('button', { name: '日本語 이름 보기' }).click();
    await expect(page.locator('.p-ja')).toContainText('すしざんまい');
    await expect(page.locator('.review').first()).toContainText('줄은 길지만');
    await page.locator('.review').first().getByRole('button', { name: '원문 보기' }).click();
    await expect(page.locator('.review').first()).toContainText('行列はすぐ進みます');
    await expect(page.getByText('예약 가능')).toBeVisible();
    await page.locator('.actions').getByRole('button', { name: '예약' }).click();
    const sheet = page.getByRole('dialog', { name: '예약하기' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('구글 지도에서 예약')).toBeVisible();
    await expect(sheet.getByText('타베로그 (食べログ)')).toBeVisible();
    await sheet.getByLabel('인원').fill('3');
    await expect(sheet.locator('.script')).toContainText('3名');
    await sheet.getByRole('button', { name: /예약함에 저장/ }).click();
    const form = page.getByRole('dialog', { name: '예약 추가' });
    await expect(form.getByLabel('이름', { exact: true })).toHaveValue(/스시 잔마이/);
    await expect(form.getByLabel('인원')).toHaveValue('3');
    await form.getByLabel('예약번호').fill('ABC123');
    await form.getByRole('button', { name: '예약함에 저장' }).click();
    await expect(page.locator('.p-name')).toContainText('스시 잔마이');
    await expect(page.getByText('ABC123')).toBeVisible();
    await expect(page.getByText('확정 대기')).toBeVisible();
  });

  test('directions: Japanese transit route with fare, platform and exit', async ({ page }) => {
    await openApp(page);
    await searchAndOpen(page, '신주쿠 교엔', /신주쿠 교엔/);
    await page.locator('.actions').getByRole('button', { name: '길찾기' }).click();
    await expect(page.locator('.leg-chip').filter({ hasText: '山手線' }).first()).toBeVisible();
    await expect(page.getByText(/¥208/).first()).toBeVisible();
    await page.getByRole('group', { name: '이동 수단' }).getByRole('button', { name: '도보' }).click();
    await expect(page.getByText(/분/).first()).toBeVisible();
  });
});

test.describe('AI chat', () => {
  for (const provider of ['gemini', 'openai', 'anthropic'] as const) {
    test(`${provider}: answers with a tool call and pins the place`, async ({ page }) => {
      await openApp(page, { settings: { provider } });
      await page.locator('.tabbar').getByText('AI', { exact: true }).click();
      await page.getByRole('textbox', { name: 'AI에게 질문' }).fill('근처 편의점 알려줘');
      await page.getByRole('button', { name: '보내기' }).click();
      const last = page.locator('.msg.ai').last();
      await expect(last).toContainText('가장 가까운 편의점은', { timeout: 20000 });
      await expect(last.locator('.pchip').first()).toBeVisible();
      await expect(last.locator('.gsources')).toContainText('Google 지도 출처');
      await last.locator('.pchip').first().click();
      await expect(page.locator('.p-name')).toBeVisible();
    });
  }

  test('without any key the chat explains how to add one', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/config', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ai: { openai: false, anthropic: false, gemini: false }, accessCodeRequired: false, google: { mapsKey: 'AIza-fake', mapId: null, grounding: false }, transit: false, limits: { perMinute: 0, perDay: 0 }, models: { openaiLive: 'x', geminiLive: 'y' }, version: 't' }) }));
    await page.goto('/');
    await page.locator('.tabbar').getByText('AI', { exact: true }).click();
    await page.getByRole('textbox', { name: 'AI에게 질문' }).fill('안녕');
    await page.getByRole('button', { name: '보내기' }).click();
    await expect(page.locator('.msg.ai .err')).toContainText('AI 키가 아직 없어요');
  });
});

test.describe('trips', () => {
  test('create a trip, add a stop, edit it', async ({ page }) => {
    await openApp(page);
    await page.locator('.tabbar').getByText('일정', { exact: true }).click();
    await page.getByRole('button', { name: /새 일정 만들기/ }).click();
    const form = page.getByRole('dialog', { name: '새 여행 일정' });
    await form.getByRole('button', { name: '도쿄', exact: true }).click();
    await form.getByRole('button', { name: '만들기' }).click();
    await expect(page.getByRole('heading', { name: /도쿄 여행/ })).toBeVisible();
    await page.getByRole('button', { name: /장소 추가/ }).first().click();
    await page.getByRole('textbox', { name: '검색어' }).fill('이치란');
    await page.getByRole('textbox', { name: '검색어' }).press('Enter');
    await page.locator('.sugg', { hasText: '중앙동구점' }).first().click();
    await expect(page.locator('.tstop', { hasText: '이치란' })).toBeVisible();
    await page.locator('.tstop', { hasText: '이치란' }).getByRole('button', { name: /편집|수정/ }).click();
    const edit = page.getByRole('dialog', { name: '일정 장소 편집' });
    await edit.getByLabel('시간', { exact: true }).fill('12:30');
    await edit.getByRole('button', { name: '저장' }).click();
    await expect(page.locator('.tstop', { hasText: '이치란' })).toContainText('12:30');
  });

  test('a shared trip link imports into my trips', async ({ page }) => {
    const trip = { title: '오사카 먹방', city: '오사카', start: '2026-11-25', end: '2026-11-27', days: [{ date: '2026-11-25', stops: [{ place: { id: 'g:ChIJ_x', name: '구로몬 시장', lat: 34.665, lng: 135.506, category: 'sight' }, time: '10:00' }] }] };
    const token = 'z' + zlib.deflateRawSync(Buffer.from(JSON.stringify(trip))).toString('base64url');
    await openApp(page, {}, `/#trip=${token}`);
    const dlg = page.getByRole('dialog', { name: '공유받은 일정' });
    await expect(dlg).toContainText('오사카 먹방');
    await expect(dlg).toContainText('구로몬 시장');
    await dlg.getByRole('button', { name: '내 일정으로 가져오기' }).click();
    await expect(page.getByRole('heading', { name: /오사카 먹방/ })).toBeVisible();
  });
});

test.describe('camera & live', () => {
  test('camera guide reads the signs in the current view', async ({ page }) => {
    await openApp(page);
    await searchAndOpen(page, '신주쿠역', '신주쿠역');
    await page.locator('.sheet').getByRole('button', { name: '카메라 길안내' }).click();
    const cam = page.getByRole('dialog', { name: '카메라 길안내' });
    await expect(cam.locator('.cam-dest b')).toHaveText('신주쿠역');
    await expect.poll(() => cam.locator('video').evaluate(v => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await cam.getByRole('button', { name: /안내받기/ }).click();
    await expect(cam.locator('.guide .say')).toContainText('東口', { timeout: 20000 });
    await expect(cam.locator('.sign-tag').first()).toContainText('東口');
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { alpha: 90, beta: 80, gamma: 0, absolute: true })));
    await expect(cam.locator('.arrow')).not.toHaveClass(/north/);
    await cam.getByRole('button', { name: '닫기' }).click();
    await expect(cam).toHaveCount(0);
  });

  test('Gemini Live: greeting, captions, tool call over the WebSocket', async ({ page }) => {
    const live = await mockGeminiLive(page);
    await openApp(page, { settings: { provider: 'gemini' } });
    await page.locator('.tabbar').getByText('AI', { exact: true }).click();
    await page.getByRole('button', { name: '실시간 카메라 대화' }).click();
    const dlg = page.getByRole('dialog', { name: '실시간 카메라 대화' });
    await expect(dlg.locator('.captions')).toContainText('노란 東口 표지판', { timeout: 20000 });
    expect(live.setup?.model).toBe('models/gemini-3.8-live');
    expect(JSON.stringify(live.setup?.tools)).toContain('where_am_i');
    expect(JSON.stringify(live.setup?.systemInstruction)).toContain('길안내');
    await expect.poll(() => live.received.some(m => (m as any).realtimeInput?.audio)).toBe(true);
    await expect.poll(() => live.received.some(m => (m as any).realtimeInput?.video)).toBe(true);
    await dlg.getByRole('button', { name: '글자로' }).click();
    await dlg.getByRole('textbox', { name: '글자로 묻기' }).fill('편의점 어디야?');
    await dlg.getByRole('button', { name: '보내기' }).click();
    await expect(dlg.locator('.captions')).toContainText('가장 가까운 곳은', { timeout: 20000 });
    await dlg.getByRole('button', { name: '끝내기' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('Claude talks turn by turn with the camera snapshot', async ({ page }) => {
    await openApp(page, { settings: { provider: 'anthropic' } });
    await page.locator('.tabbar').getByText('AI', { exact: true }).click();
    await page.getByRole('button', { name: '실시간 카메라 대화' }).click();
    const dlg = page.getByRole('dialog', { name: '실시간 카메라 대화' });
    await expect(dlg.locator('.captions')).toContainText('Claude 응답', { timeout: 20000 });
    await dlg.getByRole('button', { name: '글자로' }).click();
    await dlg.getByRole('textbox', { name: '글자로 묻기' }).fill('여기서 어디로 가?');
    await dlg.getByRole('button', { name: '보내기' }).click();
    await expect(dlg.locator('.captions .u')).toContainText('여기서 어디로 가?');
  });
});

test.describe('resilience', () => {
  test('free map + OpenStreetMap search when Google is turned off', async ({ page }) => {
    await openApp(page, { freeMap: true });
    await page.locator('.chips').getByRole('button', { name: '편의점' }).click();
    await expect(page.locator('.result')).toHaveCount(3);
    await expect(page.locator('.result').first()).toContainText('패밀리마트');
  });

  test('offline banner and strong earthquake alert', async ({ page, context }) => {
    await prepare(page);
    const t = new Date(Date.now() - 5 * 60000).toISOString();
    await page.route('**/api/quake', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ quakes: [{ id: 'q', time: t, place: '千葉県北西部', lat: 35.7, lng: 140.1, depth: 40, magnitude: 6.1, maxScale: 50, scaleText: '5강', tsunami: 'None' }] }) }));
    await page.goto('/');
    await expect(page.locator('.banner.alert')).toContainText('지진');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/오프라인/).first()).toBeVisible();
    await context.setOffline(false);
  });

  test('settings: dark theme, diagnostics and AI test', async ({ page }) => {
    await openApp(page);
    await page.locator('.tabbar').getByText('도구', { exact: true }).click();
    await page.getByRole('button', { name: /설정/ }).first().click();
    await page.getByRole('button', { name: '어둡게' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.tabbar').getByText('도구', { exact: true }).click();
    await page.locator('.tabbar').getByText('도구', { exact: true }).click();
    await page.getByRole('button', { name: /연결 진단/ }).click();
    await expect(page.locator('.diag', { hasText: '앱 서버' })).toContainText('정상');
    await expect(page.locator('.diag', { hasText: '환율' })).toContainText('9.12');
    await page.getByRole('button', { name: 'Gemini', exact: true }).click();
    await expect(page.locator('.diag', { hasText: 'Gemini 대화' })).toContainText('응답');
  });
});
