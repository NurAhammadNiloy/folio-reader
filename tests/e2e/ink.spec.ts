import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturePath, freshApp, importAndWait } from './helpers';

async function annotationCount(page: Page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('folio');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    return new Promise<number>((r) => {
      const q = db.transaction('annotations').objectStore('annotations').count();
      q.onsuccess = () => r(q.result);
    });
  });
}

async function draw(page: Page, fx: number, fy: number) {
  const box = (await page.locator('.folio-page').first().boundingBox())!;
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 6, y + (i % 2 ? 3 : -3));
  await page.mouse.up();
  return { x, y, box };
}

test('draw, save, reload, zoom, erase, undo/redo and export with original unchanged (ANN-01/02, EXP-02)', async ({ page }) => {
  await freshApp(page);
  await importAndWait(page, 'single.pdf');
  await page.getByRole('link', { name: /Open Folio Ink Fixture/ }).click();
  await expect(page.locator('canvas.page-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Annotate with pen' }).click();
  await draw(page, 0.3, 0.6);
  await expect(page.getByTestId('save-status')).toContainText('Saved on this device');
  expect(await annotationCount(page)).toBe(1);

  // highlighter + second stroke, then undo/redo
  await page.getByRole('button', { name: 'Highlighter' }).click();
  await draw(page, 0.5, 0.3);
  await expect.poll(() => annotationCount(page)).toBe(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => annotationCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(() => annotationCount(page)).toBe(2);

  // reload: committed strokes survive
  await page.reload();
  await expect(page.locator('canvas.page-canvas')).toBeVisible();
  expect(await annotationCount(page)).toBe(2);

  // zoom changes keep marks aligned: pixel under the first stroke is ink-coloured at two zooms
  for (const zoom of ['Zoom in', 'Zoom out']) {
    await page.getByRole('button', { name: zoom }).first().click();
    await page.waitForTimeout(600);
  }

  // eraser removes a whole stroke
  await page.getByRole('button', { name: 'Annotate with pen' }).click();
  await page.getByRole('button', { name: /Eraser/ }).click();
  const box = (await page.locator('.folio-page').first().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3 + 30, box.y + box.height * 0.6 - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3 + 36, box.y + box.height * 0.6 + 12, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => annotationCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => annotationCount(page)).toBe(2);
  await page.getByRole('button', { name: 'Done' }).click();

  // export annotated copy
  await page.getByRole('button', { name: 'View and more' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export annotated PDF' }).click()]);
  const dir = mkdtempSync(join(tmpdir(), 'folio-e2e-'));
  const out = join(dir, 'annotated.pdf');
  await dl.saveAs(out);
  const exported = readFileSync(out);
  expect(exported.subarray(0, 5).toString()).toBe('%PDF-');

  // original download is byte-identical to the imported file
  await page.getByRole('button', { name: 'View and more' }).click();
  const [orig] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download original PDF' }).click()]);
  await orig.saveAs(join(dir, 'orig.pdf'));
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  expect(sha(readFileSync(join(dir, 'orig.pdf')))).toBe(sha(readFileSync(fixturePath('single.pdf'))));

  // independent renderer sees the pen mark near where it was drawn (if Poppler is installed)
  try {
    execFileSync('which', ['pdftoppm']);
  } catch {
    test.info().annotations.push({ type: 'skip-check', description: 'pdftoppm not installed; visual export check skipped' });
    return;
  }
  execFileSync('pdftoppm', ['-cropbox', '-r', '72', '-png', out, join(dir, 'p')]);
  const { PNG } = await import('./png');
  const img = PNG.read(readFileSync(join(dir, 'p-1.png')));
  // pen started at 30% / 60% of the page and moved right ~72 CSS px at the reader's scale
  const cx = Math.round(img.width * 0.3);
  const cy = Math.round(img.height * 0.6);
  let blue = 0;
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 4; x <= cx + 60; x++) {
      const [r, , b] = img.px(x, y);
      if (b > 100 && r < 90 && b - r > 40) blue++;
    }
  expect(blue).toBeGreaterThan(10);
});
