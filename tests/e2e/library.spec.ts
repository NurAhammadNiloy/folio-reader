import { mkdtempSync, openSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { freshApp, importAndWait, importFiles, watchPage } from './helpers';

test.describe('library (LIB-01..03)', () => {
  test('rejects invalid files with actionable errors and never creates partial books', async ({ page }) => {
    const w = watchPage(page);
    await freshApp(page);
    await importFiles(page, 'not-a-pdf.pdf', 'malformed.pdf', 'truncated.pdf', 'empty.pdf');
    const rows = page.getByTestId('import-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('is not a PDF file');
    await expect(rows.nth(1)).toContainText('could not be opened');
    await expect(rows.nth(2)).toContainText('could not be opened');
    await expect(rows.nth(3)).toContainText('is empty');
    await expect(page.getByText('Your bookshelf is empty')).toBeVisible();
    const count = await page.evaluate(async () => {
      const req = indexedDB.open('folio');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const tx = db.transaction(['books', 'bookFiles'], 'readonly');
      const c = (s: string) => new Promise<number>((r) => { const q = tx.objectStore(s).count(); q.onsuccess = () => r(q.result); });
      return [await c('books'), await c('bookFiles')];
    });
    expect(count).toEqual([0, 0]);
    expect(w.errors.filter((e) => !/Invalid PDF|InvalidPDFException|Warning/i.test(e))).toEqual([]);
  });

  test('rejects files over 100 MB before reading them', async ({ page }) => {
    await freshApp(page);
    // Sparse 101 MiB file on disk (Playwright refuses in-memory buffers over 50 MB).
    const dir = mkdtempSync(join(tmpdir(), 'folio-huge-'));
    const huge = join(dir, 'huge.pdf');
    const fd = openSync(huge, 'w');
    writeSync(fd, '%PDF-1.7\n');
    ftruncateSync(fd, 101 * 1024 * 1024);
    closeSync(fd);
    await page.getByTestId('import-input').setInputFiles(huge);
    await expect(page.getByTestId('import-row')).toContainText('up to 100 MB');
  });

  test('detects duplicates by content hash and offers the existing book', async ({ page }) => {
    await freshApp(page);
    await importAndWait(page, 'single.pdf');
    await importFiles(page, 'single.pdf');
    await expect(page.getByTestId('import-row').last()).toContainText('Already in your library');
    await expect(page.getByRole('article')).toHaveCount(1);
  });

  test('rename, favourite, collections, search and sort', async ({ page }) => {
    await freshApp(page);
    await importAndWait(page, 'text-12p.pdf');
    await importAndWait(page, 'single.pdf');
    const card = page.getByRole('article', { name: 'Folio Ink Fixture' });
    await card.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Edit title and author…' }).click();
    await page.getByLabel('Title', { exact: true }).fill('Zebra Studies');
    await page.getByLabel('Author (optional)').fill('A. Reader');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('article', { name: 'Zebra Studies' })).toContainText('A. Reader');

    await page.getByRole('button', { name: 'Add Zebra Studies to favourites' }).click();
    await page.getByRole('button', { name: 'Favourites', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByRole('button', { name: 'All books' }).click();

    const zebra = page.getByRole('article', { name: 'Zebra Studies' });
    await zebra.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Collections…' }).click();
    await page.getByLabel('New collection').fill('Biology');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Biology' })).toBeChecked();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Biology' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByRole('button', { name: 'All books' }).click();

    await page.getByPlaceholder('Search title or author').fill('reader');
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByPlaceholder('Search title or author').fill('');
    await page.getByLabel('Sort', { exact: true }).selectOption('title');
    await expect(page.getByRole('article').first()).toHaveAccessibleName('Folio Sample Text');
  });

  test('delete warns about linked content and removes everything atomically', async ({ page }) => {
    await freshApp(page);
    await importAndWait(page, 'single.pdf');
    await page.getByRole('link', { name: /Open Folio Ink Fixture/ }).click();
    await page.getByRole('button', { name: 'Bookmark this page' }).click();
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await expect(page.getByRole('dialog')).toContainText('1 bookmark');
    await page.getByRole('button', { name: 'Delete book' }).click();
    await expect(page.getByText('Your bookshelf is empty')).toBeVisible();
  });
});
