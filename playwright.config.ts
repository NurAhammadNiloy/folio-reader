import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build (`vite preview`), with the service worker and
// the same CSP headers as Vercel. Base URL can point at a deployed preview instead.
const baseURL = process.env.FOLIO_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    ...(process.env.FOLIO_WEBKIT ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
  webServer: process.env.FOLIO_BASE_URL
    ? undefined
    : { command: 'npm run preview', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
