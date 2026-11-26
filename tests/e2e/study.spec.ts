import { test, expect } from '@playwright/test';
import { freshApp, importAndWait } from './helpers';

test('study: notebook beside the book, draw, type, link a page and jump back (NOTE-01)', async ({ page }) => {
  await freshApp(page);
  await importAndWait(page, 'text-12p.pdf');
  await page.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Study with notebook' }).click();
  await expect(page.locator('canvas.page-canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create a notebook' }).click();
  const nbPage = page.locator('[data-testid="notebook"] section .relative').first();
  await expect(nbPage).toBeVisible();
  const b = (await nbPage.boundingBox())!;
  await page.mouse.move(b.x + 50, b.y + 100);
  await page.mouse.down();
  await page.mouse.move(b.x + 150, b.y + 130, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('nb-save-status')).toContainText('Saved');
  // move the book to page 5, then link the notebook page to it
  await page.getByLabel('Go to page').fill('5');
  await page.getByLabel('Go to page').press('Enter');
  await page.getByRole('button', { name: /Link to book page/ }).click();
  await page.getByLabel('Go to page').fill('1');
  await page.getByLabel('Go to page').press('Enter');
  // label "5" is the 7th physical page; the chip names the physical page
  await page.getByRole('button', { name: /Folio Sample Text, page 7/ }).click();
  await expect(page.getByTestId('page-indicator')).toContainText('5 · 7 / 12');
  // add a page and export
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(page.locator('[data-testid="notebook"] section')).toHaveCount(2);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export notebook as PDF' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  // notebook visible from Notes view
  await page.goto('/#/notes');
  await expect(page.getByText('Folio Sample Text notes')).toBeVisible();
});

test('phone layout uses tabs instead of a cramped split', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshApp(page);
  await importAndWait(page, 'single.pdf');
  await page.goto('/');
  await page.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Study with notebook' }).click();
  await expect(page.getByRole('tab', { name: 'Book', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Notebook' }).click();
  await expect(page.getByRole('button', { name: 'Create a notebook' })).toBeVisible();
});

test('study: Ctrl+Z undoes in the pane last used, not always in the book', async ({ page }) => {
  const counts = () =>
    page.evaluate(async () => {
      const req = indexedDB.open('folio');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const get = <T,>(s: string) => new Promise<T[]>((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result as T[]); });
      const anns = await get<unknown>('annotations');
      const pages = await get<{ strokes: unknown[] }>('notebookPages');
      db.close();
      return { book: anns.length, notebook: pages.reduce((n, p) => n + p.strokes.length, 0) };
    });
  const stroke = async (b: { x: number; y: number }, dx: number, dy: number) => {
    await page.mouse.move(b.x + dx, b.y + dy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + dx + i * 8, b.y + dy + (i % 2 ? 3 : -3));
    await page.mouse.up();
  };
  await freshApp(page);
  await importAndWait(page, 'text-12p.pdf');
  await page.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Study with notebook' }).click();
  await expect(page.locator('canvas.page-canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create a notebook' }).click();
  await page.getByRole('button', { name: 'Annotate with pen' }).click();
  await stroke((await page.locator('.folio-page').first().boundingBox())!, 40, 120);
  await expect.poll(counts).toEqual({ book: 1, notebook: 0 });
  const nbPage = page.locator('[data-testid="notebook"] section .relative').first();
  await stroke((await nbPage.boundingBox())!, 40, 100);
  await expect.poll(counts).toEqual({ book: 1, notebook: 1 });
  await page.keyboard.press('Control+z');
  await expect.poll(counts).toEqual({ book: 1, notebook: 0 });
  // Arrow keys typed while in the notebook do not turn the book's page.
  const before = await page.getByTestId('page-indicator').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('page-indicator')).toHaveText(before!);
  // Back in the book, Ctrl+Z undoes the book stroke.
  // (focus a book control: tapping the page in pen mode would draw a dot)
  await page.getByLabel('Go to page').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+z');
  await expect.poll(counts).toEqual({ book: 0, notebook: 0 });
});
