import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3100);
const executablePath = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Tokyo',
    geolocation: { latitude: 35.6905, longitude: 139.7004, accuracy: 12 },
    permissions: ['geolocation', 'camera', 'microphone'],
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
