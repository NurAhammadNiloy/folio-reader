import { test, expect } from '@playwright/test';
import { freshApp, importAndWait, watchPage } from './helpers';

test('after first load, the app and imported books work offline (OFF-01)', async ({ page, context }) => {
  const w = watchPage(page);
  await freshApp(page);
  await expect(page.getByTestId('offline-status')).toContainText('Ready to use offline', { timeout: 30_000 });
  await importAndWait(page, 'unicode.pdf');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.getByRole('link', { name: /Open unicode/ }).click();
  await expect(page.locator('canvas.page-canvas').first()).toBeVisible();
  // CMaps / fonts are self-hosted: Unicode text layer present offline
  // The Chromium-printed fixture splits shaped scripts into many runs, so check the
  // text layer as a whole rather than single spans.
  const layer = page.locator('.textLayer').first();
  await expect(layer).toContainText('日本語: 読書と学習のためのアプリ。', { timeout: 15_000 });
  // PDF.js may emit decomposed diacritics; compare in NFC.
  const text = ((await layer.textContent()) ?? '').normalize('NFC');
  expect(text).toContain('Hyvää huomenta');
  expect(text).toContain('বাংলা');
  await context.setOffline(false);
  expect(w.external).toEqual([]);
  expect(w.errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
});

test('serves security headers including a restrictive CSP', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
