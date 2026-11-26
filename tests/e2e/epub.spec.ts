import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshApp, importAndWait, importFiles, watchPage } from './helpers';

async function storedSetting(page: import('@playwright/test').Page, key: string) {
  return page.evaluate(
    (k) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('folio');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('settings').objectStore('settings').get(k);
          get.onsuccess = () => {
            resolve((get.result as { value?: unknown } | undefined)?.value ?? null);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
    key,
  );
}

const indicator = (page: import('@playwright/test').Page) => page.getByTestId('epub-page-indicator');
const content = (page: import('@playwright/test').Page) => page.getByTestId('epub-content');

async function openSample(page: import('@playwright/test').Page) {
  await freshApp(page);
  await importAndWait(page, 'sample.epub');
  await page.getByRole('link', { name: /Open Folio Sample EPUB/ }).click();
  await expect(content(page)).toContainText('Chapter One');
}

test.describe('EPUB (RDR-04)', () => {
  test('import, paginate, contents, internal links, search, bookmarks, resume', async ({ page }) => {
    const w = watchPage(page);
    await freshApp(page);
    await importAndWait(page, 'sample.epub');
    const card = page.getByRole('article', { name: 'Folio Sample EPUB' });
    await expect(card).toContainText('EPUB');
    await expect(card).toContainText('3 sections');
    await expect(card.locator('img')).toHaveCount(1); // cover extracted
    await card.getByRole('link', { name: /Open Folio Sample EPUB/ }).click();
    await expect(content(page)).toContainText('Chapter One');
    await expect(indicator(page)).toContainText('Page 1 of');
    await expect(indicator(page)).toContainText('Section 1 of 3');

    // page turning within and across chapters
    await page.keyboard.press('ArrowRight');
    await expect(indicator(page)).toContainText(/Page 2 of|Section 2 of 3/);

    // contents → chapter three
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('button', { name: 'Chapter Three' }).click();
    await expect(indicator(page)).toContainText('Section 3 of 3');
    await expect(content(page)).toContainText('Later section');

    // internal link from chapter one lands in chapter three at #later
    // On wide screens the contents panel stays open after choosing an entry.
    await page.getByRole('button', { name: 'Chapter One' }).click();
    await page.getByRole('button', { name: 'Close contents' }).click();
    const jump = content(page).getByRole('link', { name: 'Jump to the later section' });
    for (let i = 0; i < 6 && !(await jump.isVisible()); i++) await page.keyboard.press('ArrowRight');
    await jump.click();
    await expect(indicator(page)).toContainText('Section 3 of 3');
    await expect(content(page).locator('#epub-2-later')).toBeInViewport();

    // search across chapters
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.getByRole('searchbox', { name: 'Search in book' }).fill('quasar2');
    await page.getByRole('searchbox', { name: 'Search in book' }).press('Enter');
    await expect(page.getByTestId('epub-search-status')).toContainText('Match 1 of 1');
    await expect(indicator(page)).toContainText('Section 2 of 3');
    await expect(content(page).locator('mark.folio-hit.active')).toBeInViewport();
    await page.getByRole('button', { name: 'Close search' }).click();

    // bookmark, then reload resumes here
    await page.getByRole('button', { name: 'Bookmark this place' }).click();
    await expect(page.getByRole('button', { name: 'Remove bookmark here' })).toBeVisible();
    const where = await indicator(page).textContent();
    await page.reload();
    await expect(indicator(page)).toHaveText(where!);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Bookmarks' }).click();
    await expect(page.getByTestId('epub-panel')).toContainText('Chapter Two');

    // images come from the archive as blob URLs
    await expect(content(page).locator('img').first()).toHaveAttribute('src', /^blob:/);
    expect(w.external).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('text settings change layout and persist; scroll layout works', async ({ page }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Text settings' }).click();
    const size = () => content(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const before = await size();
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.getByRole('button', { name: 'Larger text' }).click();
    await expect(page.getByTestId('epub-type-panel')).toContainText('120%');
    expect(await size()).toBeGreaterThan(before * 1.15);
    await page.getByRole('button', { name: 'Sans' }).click();
    await page.getByRole('button', { name: 'Scroll' }).click();
    await expect(indicator(page)).not.toContainText('Page ');
    // Reload only after the setting has reached IndexedDB (an in-flight write can be cut off by navigation).
    await expect.poll(() => storedSetting(page, 'epubTypography')).toMatchObject({ layout: 'scroll', font: 'sans', size: 120 });
    await page.reload();
    await expect(content(page)).toContainText('Chapter One');
    expect(await size()).toBeGreaterThan(before * 1.15);
    await expect(indicator(page)).not.toContainText('Page ');
    // scroll to the end moves on with the next-page key
    for (let i = 0; i < 30 && !(await indicator(page).textContent())?.includes('Section 2 of 3'); i++) await page.keyboard.press('PageDown');
    await expect(indicator(page)).toContainText('Section 2 of 3');
    await expect(content(page)).toContainText('Chapter Two');
  });

  test('external links need explicit confirmation', async ({ page, context }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('button', { name: 'Chapter Two' }).click();
    const ext = content(page).getByRole('link', { name: 'example link' });
    for (let i = 0; i < 6 && !(await ext.isVisible()); i++) await page.keyboard.press('ArrowRight');
    let opened = false;
    context.on('page', () => (opened = true));
    await ext.click();
    const dialog = page.getByRole('dialog', { name: 'Open external link?' });
    await expect(dialog).toContainText('https://example.com/');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(300);
    expect(opened).toBe(false);
  });

  test('hostile EPUB: no script, no handlers, no remote loads, no dialogs', async ({ page }) => {
    const w = watchPage(page);
    let dialog = false;
    page.on('dialog', async (d) => {
      dialog = true;
      await d.dismiss();
    });
    await freshApp(page);
    await importAndWait(page, 'hostile.epub');
    await page.getByRole('link', { name: /Open Folio Hostile EPUB/ }).click();
    await expect(content(page)).toContainText('Safe text survives');
    await content(page).getByText('Paragraph with event handlers.').hover();
    await content(page).getByText('Paragraph with event handlers.').click();
    await content(page).getByText('javascript link').click();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __folioHacked?: number }).__folioHacked)).toBeUndefined();
    expect(dialog).toBe(false);
    expect(await content(page).locator('script, iframe, object, form, style, link, svg, [onclick], [href]').count()).toBe(0);
    expect(w.external).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('DRM and broken EPUBs are refused with a clear message', async ({ page }) => {
    await freshApp(page);
    await importFiles(page, 'drm.epub');
    await expect(page.getByTestId('import-row').last()).toContainText('DRM');
    await expect(page.getByRole('article')).toHaveCount(0);
  });

  test('right-to-left EPUB turns pages with the left arrow', async ({ page }) => {
    await freshApp(page);
    await importAndWait(page, 'rtl.epub');
    await page.getByRole('link', { name: /Open Folio RTL EPUB/ }).click();
    await expect(content(page)).toHaveAttribute('dir', 'rtl');
    await expect(indicator(page)).toContainText('Page 1 of');
    await page.keyboard.press('ArrowLeft');
    await expect(indicator(page)).toContainText(/Page 2 of|Section 2 of 2/);
  });

  test('EPUB survives a full backup and restore in a fresh profile', async ({ page, browser }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('button', { name: 'Chapter Three' }).click();
    await expect(indicator(page)).toContainText('Section 3 of 3');
    await page.getByRole('button', { name: 'Bookmark this place' }).click();
    await page.waitForTimeout(500);
    await page.goto('/#/settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export full backup' }).click()]);
    const file = join(mkdtempSync(join(tmpdir(), 'folio-epub-')), 'lib.folio-backup');
    await dl.saveAs(file);
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto('/#/settings');
    await p2.getByTestId('restore-input').setInputFiles(file);
    await expect(p2.getByRole('dialog')).toContainText('All checksums are valid');
    await p2.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(p2.getByRole('dialog')).toContainText('Restore complete');
    await p2.goto('/');
    await p2.getByRole('link', { name: /Open Folio Sample EPUB/ }).click();
    await expect(p2.getByTestId('epub-page-indicator')).toContainText('Section 3 of 3');
    await ctx2.close();
  });

  test('study: notebook beside an EPUB links to a section and jumps back', async ({ page }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Study with notebook' }).click();
    await page.getByRole('button', { name: 'Create a notebook' }).click();
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('button', { name: 'Chapter Three' }).click();
    await expect(indicator(page)).toContainText('Section 3 of 3');
    await page.getByRole('button', { name: 'Link to book section 3' }).click();
    // In the narrower study pane the contents panel closes after a choice.
    if (!(await page.getByRole('button', { name: 'Chapter One' }).isVisible())) await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('button', { name: 'Chapter One' }).click();
    await expect(indicator(page)).toContainText('Section 1 of 3');
    await page.getByRole('button', { name: /Folio Sample EPUB, section 3/ }).click();
    await expect(indicator(page)).toContainText('Section 3 of 3');
  });
});
