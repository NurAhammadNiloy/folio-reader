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
