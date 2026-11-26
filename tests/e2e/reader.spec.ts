import { test, expect } from '@playwright/test';
import { freshApp, importAndWait, watchPage } from './helpers';

async function open(page: import('@playwright/test').Page, fixture: string, title: RegExp) {
  await freshApp(page);
  await importAndWait(page, fixture);
  await page.getByRole('link', { name: title }).click();
  await expect(page.locator('.folio-page canvas.page-canvas').first()).toBeVisible();
}

test.describe('reader (RDR-01..03, RDR-05, PRG-01)', () => {
  test('page labels, jump, outline, thumbnails and keyboard', async ({ page }) => {
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await expect(page.getByTestId('page-indicator')).toContainText('i · 1 / 12');
    await page.getByLabel('Go to page').fill('5');
    await page.getByLabel('Go to page').press('Enter');
    // "5" is a page label (front matter is i, ii), so it is the 7th page.
    await expect(page.getByTestId('page-indicator')).toContainText('5 · 7 / 12');
    await page.getByLabel('Go to page').fill('ii');
    await page.getByLabel('Go to page').press('Enter');
    await expect(page.getByTestId('page-indicator')).toContainText('ii · 2 / 12');
    await page.getByRole('button', { name: 'Contents' }).click();
    await page.getByRole('button', { name: /Chapter Three/ }).click();
    await expect(page.getByTestId('page-indicator')).toContainText('9 / 12');
    await page.getByRole('button', { name: 'Close contents' }).click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('page-indicator')).toContainText('10 / 12');
    await page.keyboard.press('Home');
    await expect(page.getByTestId('page-indicator')).toContainText('1 / 12');
    await page.getByRole('button', { name: 'Page thumbnails' }).click();
    await page.getByRole('button', { name: 'Go to page 4' }).click();
    await expect(page.getByTestId('page-indicator')).toContainText('6 / 12');
  });

  test('search finds embedded text, navigates matches and highlights them', async ({ page }) => {
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.getByRole('searchbox', { name: 'Search in book' }).fill('zephyr7');
    await page.getByRole('searchbox', { name: 'Search in book' }).press('Enter');
    await expect(page.getByTestId('search-status')).toContainText('Match 1 of 1');
    await expect(page.getByTestId('page-indicator')).toContainText('7 / 12');
    await expect(page.locator('mark.folio-hit.active')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search in book' }).fill('fixture page');
    await page.getByRole('searchbox', { name: 'Search in book' }).press('Enter');
    await expect(page.getByTestId('search-status')).toContainText('of 12');
    await page.getByRole('button', { name: 'Next match' }).click();
    await expect(page.getByTestId('page-indicator')).toContainText('2 / 12');
  });

  test('text layer is selectable', async ({ page }) => {
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await expect(page.locator('.textLayer span', { hasText: 'Folio fixture page 1' })).toHaveCount(1);
  });

  test('scanned pages show a no-text notice', async ({ page }) => {
    await open(page, 'scanned.pdf', /Open Folio Scanned Fixture/);
    await expect(page.getByTestId('no-text-notice')).toBeVisible();
  });

  test('view modes: spread, scroll, zoom and rotation keep the position', async ({ page }) => {
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await page.getByRole('button', { name: 'View and more' }).click();
    await page.getByRole('menuitem', { name: 'Two-page spread' }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('visible-pages').locator('[data-page-index]:not(.folio-prefetch)').filter({ has: page.locator('canvas') })).toHaveCount(2);
    await page.getByRole('button', { name: 'View and more' }).click();
    await page.getByRole('menuitem', { name: 'Continuous scroll' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).first().click();
    await page.getByRole('button', { name: 'View and more' }).click();
    await page.getByRole('menuitem', { name: 'Rotate view' }).click();
    await expect(page.getByTestId('page-indicator')).toContainText('2 / 12');
  });

  test('RTL direction swaps arrow keys in paged views', async ({ page }) => {
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await page.getByRole('button', { name: 'View and more' }).click();
    await page.getByRole('menuitem', { name: /Reading direction: left to right/ }).click();
    await page.getByRole('button', { name: 'View and more' }).click();
    await expect(page.getByRole('menuitem', { name: /Reading direction: right to left/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('page-indicator')).toContainText('2 / 12');
  });

  test('500-page document: 1 → 250 → 500 → 1 within the canvas budget', async ({ page }) => {
    const w = watchPage(page);
    await open(page, 'large-500p.pdf', /Open Folio Large Fixture/);
    for (const target of [250, 500, 1]) {
      await page.getByLabel('Go to page').fill(String(target));
      await page.getByLabel('Go to page').press('Enter');
      await expect(page.getByTestId('page-indicator')).toContainText(`${target} / 500`);
      await expect(page.locator('.textLayer span', { hasText: `Large fixture page ${target}` })).toHaveCount(1, { timeout: 15_000 });
    }
    // scroll mode with many pages: canvases stay bounded
    await page.getByRole('button', { name: 'View and more' }).click();
    await page.getByRole('menuitem', { name: 'Continuous scroll' }).click();
    for (let i = 0; i < 15; i++) await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
    expect(await page.locator('canvas.page-canvas').count()).toBeLessThanOrEqual(6);
    expect(w.errors).toEqual([]);
  });

  test('rotated, cropped and mixed-size pages render', async ({ page }) => {
    const w = watchPage(page);
    await open(page, 'geometry.pdf', /Open Folio Geometry Fixture/);
    for (let i = 2; i <= 6; i++) {
      await page.getByRole('button', { name: 'Next page' }).click();
      await expect(page.getByTestId('page-indicator')).toContainText(`${i} / 6`);
      await expect(page.locator('.textLayer span', { hasText: `Geometry page ${i}` })).toHaveCount(1);
    }
    expect(w.errors).toEqual([]);
  });

  test('hostile PDF: no script execution, no automatic navigation, no external requests', async ({ page }) => {
    const w = watchPage(page);
    let dialog = false;
    page.on('dialog', async (d) => {
      dialog = true;
      await d.dismiss();
    });
    await open(page, 'hostile.pdf', /Open Folio Hostile Fixture/);
    await page.locator('.folio-page').first().click({ position: { x: 120, y: 120 } });
    await page.waitForTimeout(500);
    expect(dialog).toBe(false);
    expect(page.url()).toContain('#/reader/');
    expect(w.external).toEqual([]);
  });

  test('bookmarks: create, rename, jump, remove, survive reload', async ({ page }) => {
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await page.getByLabel('Go to page').fill('4');
    await page.getByLabel('Go to page').press('Enter');
    await expect(page.getByTestId('page-indicator')).toContainText('4 · 6 / 12');
    await page.getByRole('button', { name: 'Bookmark this page' }).click();
    // The toggle flips from the stored record, so the write has committed before we reload.
    await expect(page.getByRole('button', { name: 'Remove bookmark for this page' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('page-indicator')).toContainText('4 · 6 / 12');
    await page.getByRole('button', { name: 'View and more' }).click();
    await page.getByRole('menuitem', { name: 'Bookmarks' }).click();
    await page.getByRole('button', { name: 'Rename bookmark Page 4' }).click();
    await page.getByLabel('Bookmark name').fill('Key idea');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('page-indicator')).toContainText('i · 1 / 12');
    await page.getByRole('button', { name: /Key idea/ }).first().click();
    await expect(page.getByTestId('page-indicator')).toContainText('4 · 6 / 12');
    await page.getByRole('button', { name: 'Remove bookmark Key idea' }).click();
    await expect(page.getByText('No bookmarks yet.')).toBeVisible();
  });
  test('touch swipe turns the page (real touch events, native panning allowed)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses the Chromium DevTools touch input');
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    await expect(page.getByTestId('page-indicator')).toContainText('1 / 12');
    const box = (await page.locator('.folio-page').first().boundingBox())!;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (x0: number, x1: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 6, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const mid = box.x + box.width / 2;
    await swipe(mid + 120, mid - 120);
    await expect(page.getByTestId('page-indicator')).toContainText('2 / 12');
    await swipe(mid - 120, mid + 120);
    await expect(page.getByTestId('page-indicator')).toContainText('1 / 12');
  });
  test('page turn reuses the prefetched canvas and plays the turning-page motion (D18, RDR-06)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, 'text-12p.pdf', /Open Folio Sample Text/);
    const next = page.locator('[data-page-index="1"].folio-prefetch canvas.page-canvas');
    await expect(next).toHaveCount(1);
    await next.evaluate((c) => ((c as HTMLCanvasElement & { __mark?: number }).__mark = 42));
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.folio-turn-stage')).toHaveCount(1);
    const shown = page.locator('[data-page-index="1"]:not(.folio-prefetch) canvas.page-canvas');
    expect(await shown.evaluate((c) => (c as HTMLCanvasElement & { __mark?: number }).__mark)).toBe(42);
    await expect(page.locator('.folio-turn-stage')).toHaveCount(0);
    // Reduced motion: no turning page.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('page-indicator')).toContainText('3 / 12');
    expect(await page.locator('.folio-turn-stage').count()).toBe(0);
  });
});
