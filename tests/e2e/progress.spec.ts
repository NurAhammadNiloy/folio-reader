import { test, expect } from '@playwright/test';
import { freshApp, importAndWait } from './helpers';

test('progress: qualifying pages count once, position is separate, complete and reset (PRG-01)', async ({ page }) => {
  await freshApp(page);
  await importAndWait(page, 'text-12p.pdf');
  await page.getByRole('link', { name: /Open Folio Sample Text/ }).click();
  await expect(page.locator('.folio-page canvas.page-canvas').first()).toBeVisible();
  // Default qualify time is 5 s of continuous visibility. Page 1, then page 2.
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForTimeout(6000);
  // A quick revisit of page 1 must not add a third page.
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: 'Back to library' }).click();
  const card = page.getByRole('article', { name: 'Folio Sample Text' });
  await expect(card).toContainText('17% of pages viewed'); // 2 of 12
  await expect(card).toContainText('Page 1 of 12');

  await card.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Mark as completed' }).click();
  await expect(card).toContainText('Completed');

  await card.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Reset progress…' }).click();
  await page.getByRole('button', { name: 'Reset progress' }).click();
  await expect(card).not.toContainText('Completed');
  await expect(card).not.toContainText('of pages viewed');
  await expect(card).toContainText('Page 1 of 12'); // position kept
});
