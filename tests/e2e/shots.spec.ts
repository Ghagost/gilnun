/* Screenshots of every main screen for visual review (phone light/dark, Galaxy Fold inner screen). */
import { expect, mockGeminiLive, openApp, searchAndOpen, test } from './fixtures';

const OUT = 'test-results/shots';
const CONFIGS = [
  { name: 'phone', viewport: { width: 412, height: 915 }, dark: false },
  { name: 'dark', viewport: { width: 412, height: 915 }, dark: true },
  { name: 'fold', viewport: { width: 884, height: 800 }, dark: false },
];

for (const c of CONFIGS) {
  test.describe(`shots ${c.name}`, () => {
    test.use({ viewport: c.viewport, colorScheme: c.dark ? 'dark' : 'light' });

    test('map, search, place, booking, directions', async ({ page }) => {
      await openApp(page, { dark: c.dark });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${c.name}-01-home.png` });
      await page.locator('.chips').getByRole('button', { name: '편의점' }).click();
      await expect(page.locator('.result')).toHaveCount(3);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${c.name}-02-results.png` });
      await searchAndOpen(page, '스시', /스시 잔마이/);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${c.name}-03-place.png` });
      await page.locator('.actions').getByRole('button', { name: '예약' }).click();
      await expect(page.getByRole('dialog', { name: '예약하기' })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-04-booking.png` });
      await page.getByRole('dialog', { name: '예약하기' }).getByRole('button', { name: '닫기' }).click();
      await page.locator('.actions').getByRole('button', { name: '길찾기' }).click();
      await expect(page.locator('.route-card').first()).toBeVisible();
      await page.locator('.route-card').first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-05-directions.png` });
    });

    test('AI chat, trip, reservations, tools, settings', async ({ page }) => {
      await openApp(page, { dark: c.dark, settings: { provider: 'gemini' } });
      await page.locator('.tabbar').getByText('AI', { exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-06-chat-empty.png` });
      await page.getByRole('textbox', { name: 'AI에게 질문' }).fill('근처 편의점 알려줘');
      await page.getByRole('button', { name: '보내기' }).click();
      await expect(page.locator('.msg.ai').last()).toContainText('가장 가까운 편의점은', { timeout: 20000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-07-chat-answer.png` });

      await page.locator('.tabbar').getByText('일정', { exact: true }).click();
      await page.getByRole('button', { name: /새 일정 만들기/ }).click();
      await page.getByRole('dialog', { name: '새 여행 일정' }).getByRole('button', { name: '도쿄', exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${c.name}-08-trip-form.png` });
      await page.getByRole('dialog', { name: '새 여행 일정' }).getByRole('button', { name: '만들기' }).click();
      await page.getByRole('button', { name: /장소 추가/ }).first().click();
      await page.getByRole('textbox', { name: '검색어' }).fill('이치란');
      await page.getByRole('textbox', { name: '검색어' }).press('Enter');
      await page.locator('.sugg', { hasText: '중앙동구점' }).first().click();
      await page.getByRole('button', { name: /장소 추가/ }).first().click();
      await page.getByRole('textbox', { name: '검색어' }).fill('교엔');
      await page.getByRole('textbox', { name: '검색어' }).press('Enter');
      await page.locator('.sugg', { hasText: '신주쿠 교엔' }).first().click();
      await expect(page.locator('.tstop')).toHaveCount(2);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${c.name}-09-trip.png` });

      await page.locator('.tabbar').getByText('예약', { exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${c.name}-10-reservations-empty.png` });
      await page.getByRole('button', { name: '직접 입력' }).click();
      const form = page.getByRole('dialog', { name: '예약 추가' });
      await form.getByLabel('이름', { exact: true }).fill('호텔 그레이서리 신주쿠');
      await form.getByRole('button', { name: '숙소' }).click();
      await form.getByLabel('예약번호').fill('BK-55102');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${c.name}-11-res-form.png` });
      await form.getByRole('button', { name: '예약함에 저장' }).click();
      await expect(page.getByText('BK-55102')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-12-reservation.png` });

      await page.locator('.tabbar').getByText('도구', { exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-13-tools.png` });
      await page.locator('.tool', { hasText: '설정' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-14-settings.png` });
    });

    test('tools, scan a confirmation, saved places', async ({ page }) => {
      await openApp(page, { dark: c.dark, settings: { provider: 'openai' } });
      await page.locator('.tabbar').getByText('도구', { exact: true }).click();
      for (const [tool, file] of [['회화 카드', '19-phrases'], ['통역', '20-interpreter'], ['환율 계산기', '21-currency'], ['날씨', '22-weather'], ['안전', '23-safety'], ['연결 진단', '24-diagnostics']] as const) {
        await page.locator('.tool', { hasText: tool }).click();
        await page.waitForTimeout(tool === '연결 진단' ? 1500 : 500);
        await page.screenshot({ path: `${OUT}/${c.name}-${file}.png` });
        await page.locator('.tabbar').getByText('도구', { exact: true }).click();
      }
      await page.locator('.tabbar').getByText('예약', { exact: true }).click();
      await page.getByRole('button', { name: '직접 입력' }).click();
      const form = page.getByRole('dialog', { name: '예약 추가' });
      await form.locator('input[type=file]').first().setInputFiles({ name: 'confirm.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
      await expect(form.getByLabel('예약번호')).toHaveValue('TBL-77812', { timeout: 20000 });
      await expect(form.getByLabel('이름', { exact: true })).toHaveValue('すしざんまい 新宿店');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${c.name}-25-scan.png` });
      await form.getByRole('button', { name: '예약함에 저장' }).click();
      await expect(page.getByText('TBL-77812')).toBeVisible();
      await page.locator('.tabbar').getByText('지도', { exact: true }).click();
      await page.getByRole('button', { name: '저장한 곳' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-26-saved.png` });
    });

    test('camera guide, live talk, big text, onboarding', async ({ page }) => {
      await mockGeminiLive(page);
      await openApp(page, { dark: c.dark, onboarded: false, settings: { provider: 'gemini' } });
      await expect(page.getByRole('dialog', { name: '길눈 시작하기' })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-15-onboarding.png` });
      await page.getByRole('button', { name: '건너뛰기' }).click();

      await searchAndOpen(page, '신주쿠역', '신주쿠역');
      await page.locator('.sheet').getByRole('button', { name: '직원에게 보여주기' }).click();
      await expect(page.getByRole('dialog', { name: '직원에게 보여주기' })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${c.name}-16-bigtext.png` });
      await page.getByRole('dialog', { name: '직원에게 보여주기' }).getByRole('button', { name: '닫기' }).click();

      await page.locator('.sheet').getByRole('button', { name: '카메라 길안내' }).click();
      const cam = page.getByRole('dialog', { name: '카메라 길안내' });
      await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { alpha: 30, beta: 80, gamma: 0, absolute: true })));
      await cam.getByRole('button', { name: /안내받기/ }).click();
      await expect(cam.locator('.guide .say')).toContainText('東口', { timeout: 20000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${c.name}-17-camera.png` });
      await cam.getByRole('button', { name: '닫기' }).click();

      await page.locator('.tabbar').getByText('AI', { exact: true }).click();
      await page.getByRole('button', { name: '실시간 카메라 대화' }).click();
      const live = page.getByRole('dialog', { name: '실시간 카메라 대화' });
      await expect(live.locator('.captions')).toContainText('東口', { timeout: 20000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${c.name}-18-live.png` });
    });
  });
}
