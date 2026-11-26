import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { freshApp, importAndWait } from './helpers';

// Benchmarks from plan §12.6. Measured in headless Chromium on the build machine,
// so the numbers describe this environment only, not an iPad.
test('benchmarks: 100-page first page, 500-page navigation', async ({ page, browserName }) => {
  const results: Record<string, number> = {};
  await freshApp(page);
  await importAndWait(page, 'text-100p.pdf');
  await page.goto('/');
  let t0 = Date.now();
  await page.getByRole('link', { name: /Open Folio Benchmark Text/ }).click();
  await expect(page.locator('.folio-page canvas.page-canvas').first()).toBeVisible();
  results.firstVisiblePage100pMs = Date.now() - t0;

  await page.goto('/');
  await importAndWait(page, 'large-500p.pdf');
  t0 = Date.now();
  await page.getByRole('link', { name: /Open Folio Large Fixture/ }).click();
  await expect(page.locator('.folio-page canvas.page-canvas').first()).toBeVisible();
  results.firstVisiblePage500pMs = Date.now() - t0;
  for (const target of [250, 500, 1]) {
    t0 = Date.now();
    await page.getByLabel('Go to page').fill(String(target));
    await page.getByLabel('Go to page').press('Enter');
    await expect(page.locator('.textLayer span', { hasText: `Large fixture page ${target}` })).toHaveCount(1, { timeout: 15_000 });
    results[`jumpTo${target}Ms`] = Date.now() - t0;
  }
  mkdirSync('docs/qa', { recursive: true });
  writeFileSync(
    `docs/qa/perf-${browserName}.json`,
    JSON.stringify({ measuredAt: new Date().toISOString(), environment: 'headless Chromium, cloud build container, 1366x768', results }, null, 2) + '\n',
  );
  expect(results.firstVisiblePage100pMs).toBeLessThan(2000);
});
