import { expect, openApp, prepare, test } from './fixtures';

const PORT = Number(process.env.E2E_PORT || 3100);

test.describe('installable app', () => {
  test.use({ serviceWorkers: 'allow', baseURL: `http://localhost:${PORT}` });

  test('works offline after the first visit (service worker)', async ({ page, context }) => {
    await prepare(page);
    await page.goto('/');
    await expect(page.locator('.tabbar')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Give the worker time to copy the files the first visit used.
    await expect.poll(async () => page.evaluate(async () => {
      const names = await caches.keys();
      const st = names.find(n => n.endsWith('-static'));
      return st ? (await (await caches.open(st)).keys()).length : 0;
    }), { timeout: 15000 }).toBeGreaterThan(3);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.getByText(/오프라인/).first()).toBeVisible();
    await page.locator('.tabbar').getByText('도구', { exact: true }).click();
    await page.locator('.tool', { hasText: '회화 카드' }).click();
    await expect(page.locator('.phrase').first()).toBeVisible();
    await context.setOffline(false);
  });

  test('manifest and icons are served', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m.short_name).toBe('길눈');
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
    expect((await request.get('/sw.js')).headers()['cache-control']).toContain('no-cache');
  });
});

test.describe('navigation', () => {
  test('Android back closes overlays, then panels, then returns to the map', async ({ page }) => {
    await openApp(page);
    await page.locator('.chips').getByRole('button', { name: '편의점' }).click();
    await page.locator('.result').first().click();
    await expect(page.locator('.p-name')).toBeVisible();
    await page.locator('.sheet').getByRole('button', { name: '카메라 길안내' }).click();
    await expect(page.getByRole('dialog', { name: '카메라 길안내' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: '카메라 길안내' })).toHaveCount(0);
    await expect(page.locator('.p-name')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.result').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('.result')).toHaveCount(0);
    await expect(page.locator('.tabbar')).toBeVisible();
  });
});
