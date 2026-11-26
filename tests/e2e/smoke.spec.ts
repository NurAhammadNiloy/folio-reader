import { test, expect } from '@playwright/test';
import { freshApp, importAndWait, watchPage } from './helpers';

test('import a PDF, open it, navigate and resume after reload', async ({ page }) => {
  const w = watchPage(page);
  await freshApp(page);
  await expect(page.getByText('Your bookshelf is empty')).toBeVisible();
  await importAndWait(page, 'text-12p.pdf');
  const card = page.getByRole('article', { name: 'Folio Sample Text' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('12 pp');
  await card.getByRole('link', { name: /Open Folio Sample Text/ }).click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.locator('.folio-page canvas.page-canvas').first()).toBeVisible();
  await expect(page.getByTestId('page-indicator')).toContainText('1 / 12');
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('page-indicator')).toContainText('3 / 12');
  await page.waitForTimeout(800); // debounced location save
  await page.reload();
  await expect(page.getByTestId('page-indicator')).toContainText('3 / 12');
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});
