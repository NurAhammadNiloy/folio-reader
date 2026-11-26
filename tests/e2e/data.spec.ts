import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { freshApp, importAndWait, fixturePath } from './helpers';

async function dump(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('folio');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = (s: string) => new Promise<unknown[]>((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
    const files = (await all('bookFiles')) as { bookId: string; blob: Blob }[];
    const hashes: string[] = [];
    for (const f of files) {
      const d = await crypto.subtle.digest('SHA-256', await f.blob.arrayBuffer());
      hashes.push([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    }
    const pages = (await all('notebookPages')) as { textBlocks: { text: string }[] }[];
    return {
      books: ((await all('books')) as { id: string; hash: string }[]).map((b) => b.hash).sort(),
      fileHashes: hashes.sort(),
      annotations: ((await all('annotations')) as { id: string; points: unknown }[]).map((a) => a.id + JSON.stringify(a.points)).sort(),
      bookmarks: ((await all('bookmarks')) as { id: string }[]).map((b) => b.id).sort(),
      notebookText: pages.flatMap((p) => p.textBlocks.map((t) => t.text)).sort(),
      location: ((await all('readingProgress')) as { lastLocation: unknown }[]).map((p) => JSON.stringify(p.lastLocation)).sort(),
    };
  });
}

test('import → annotate → notebook → backup → restore in a fresh browser profile yields identical data (EXP-01 gate)', async ({ page, browser }) => {
  await freshApp(page);
  await importAndWait(page, 'text-12p.pdf');
  await page.getByRole('link', { name: /Open Folio Sample Text/ }).click();
  await expect(page.locator('canvas.page-canvas').first()).toBeVisible();
  await page.getByLabel('Go to page').fill('3');
  await page.getByLabel('Go to page').press('Enter');
  await page.getByRole('button', { name: 'Bookmark this page' }).click();
  await page.getByRole('button', { name: 'Annotate with pen' }).click();
  const box = (await page.locator('.folio-page').first().boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Study with notebook' }).click();
  await page.getByRole('button', { name: 'Create a notebook' }).click();
  await page.getByRole('button', { name: 'Add text (tap the page)' }).click();
  await page.locator('[data-testid="notebook"] section .relative').first().click({ position: { x: 60, y: 80 } });
  await page.getByPlaceholder('Type a note').fill('বাংলা নোট — مرحبا — Hyvää');
  await page.getByPlaceholder('Type a note').blur();
  await expect(page.getByTestId('nb-save-status')).toContainText('Saved');
  await page.waitForTimeout(600);
  await page.goto('/#/settings');
  const before = await dump(page);
  expect(before.annotations).toHaveLength(1);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export full backup' }).click()]);
  const dir = mkdtempSync(join(tmpdir(), 'folio-backup-'));
  const backup = join(dir, 'lib.folio-backup');
  await dl.saveAs(backup);

  // Fresh profile = new browser context with empty storage.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('/#/settings');
  await p2.getByTestId('restore-input').setInputFiles(backup);
  await expect(p2.getByRole('dialog')).toContainText('All checksums are valid');
  await p2.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(p2.getByRole('dialog')).toContainText('Restore complete');
  const after = await dump(p2);
  expect(after).toEqual(before);
  const sha = createHash('sha256').update(readFileSync(fixturePath('text-12p.pdf'))).digest('hex');
  expect(after.fileHashes).toEqual([sha]);
  await p2.goto('/');
  await p2.getByRole('link', { name: /Open Folio Sample Text/ }).click();
  await expect(p2.getByTestId('page-indicator')).toContainText('3 · 5 / 12');
  await ctx2.close();
});

test('restore rejects a path-traversal archive without changing the library', async ({ page }) => {
  await freshApp(page);
  await importAndWait(page, 'single.pdf');
  const dir = mkdtempSync(join(tmpdir(), 'folio-evil-'));
  const evil = join(dir, 'evil.folio-backup');
  writeFileSync(evil, zipSync({ 'manifest.json': strToU8('{}'), '../../evil.sh': strToU8('rm -rf /') }));
  await page.goto('/#/settings');
  await page.getByTestId('restore-input').setInputFiles(evil);
  await expect(page.getByRole('dialog')).toContainText('unexpected file');
  await expect(page.getByRole('dialog')).toContainText('Nothing was changed');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('delete all data requires typed confirmation', async ({ page }) => {
  await freshApp(page);
  await importAndWait(page, 'single.pdf');
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Delete all Folio data…' }).click();
  const confirm = page.getByRole('button', { name: 'Delete everything' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Confirmation').fill('DELETE');
  await confirm.click();
  await expect(page.getByText('All Folio data was deleted from this browser.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Your bookshelf is empty')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Your bookshelf is empty')).toBeVisible();
});

test('a library written by a newer schema is refused, not opened or downgraded', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('folio-test-newer')) return;
    sessionStorage.setItem('folio-test-newer', '1');
    const q = indexedDB.open('folio', 9999);
    q.onupgradeneeded = () => q.result.createObjectStore('futureTable');
    q.onsuccess = () => q.result.close();
  });
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'saved by a newer version of Folio' })).toBeVisible();
  const version = await page.evaluate(
    () => new Promise<number>((r) => { const q = indexedDB.open('folio'); q.onsuccess = () => { r(q.result.version); q.result.close(); }; }),
  );
  expect(version).toBe(9999);
});
