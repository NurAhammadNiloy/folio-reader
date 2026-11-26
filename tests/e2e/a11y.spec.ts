import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { freshApp, importAndWait } from './helpers';

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1366, height: 768 },
];
const SHOTS = 'docs/qa/screenshots';

async function noHorizontalOverflow(page: import('@playwright/test').Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
}

test('responsive layouts have no horizontal overflow and pass axe checks (A11Y-01)', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await freshApp(page);
  await importAndWait(page, 'text-12p.pdf');
  await importAndWait(page, 'unicode.pdf');
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    for (const [route, label] of [['/', 'library'], ['/#/notes', 'notes'], ['/#/settings', 'settings']] as const) {
      await page.goto(route);
      await page.waitForTimeout(400);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `${SHOTS}/${label}-${s.name}.png` });
      if (s.name === 'desktop' || s.name === 'phone') {
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(res.violations.map((v) => `${label}/${s.name}: ${v.id} ${v.nodes.length}`)).toEqual([]);
      }
    }
    await page.goto('/');
    await page.getByRole('link', { name: /Open Folio Sample Text/ }).click();
    await expect(page.locator('canvas.page-canvas').first()).toBeVisible();
    await page.waitForTimeout(500);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOTS}/reader-${s.name}.png` });
    if (s.name === 'desktop' || s.name === 'phone') {
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).exclude('.textLayer').analyze();
      expect(res.violations.map((v) => `reader/${s.name}: ${v.id} ${v.nodes.length}`)).toEqual([]);
    }
  }
});

test('keyboard-only: skip link, import button and book open are reachable', async ({ page }) => {
  await freshApp(page);
  await importAndWait(page, 'single.pdf');
  await page.reload(); // fresh document so focus starts at the top
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  expect(page.url()).not.toContain('#main');
  let found = false;
  for (let i = 0; i < 25 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Open ') ?? false);
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('reader')).toBeVisible();
});

test('dark theme passes axe contrast checks', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await freshApp(page);
  await importAndWait(page, 'single.pdf');
  await page.goto('/');
  const res = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
  expect(res.violations.map((v) => `${v.id} ${v.nodes.length}`)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/library-dark.png` });
});
