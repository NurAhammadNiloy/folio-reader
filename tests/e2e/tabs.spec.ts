import { test, expect } from '@playwright/test';
import { freshApp } from './helpers';

test('a second tab is read-only until the first one closes (single-writer)', async ({ page, context }) => {
  await freshApp(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText(/this tab is read-only/)).toBeVisible();
  await expect(second.getByRole('button', { name: 'Import PDF' })).toBeDisabled();
  await page.close();
  await expect(second.getByText(/this tab is read-only/)).toBeHidden({ timeout: 10_000 });
  await expect(second.getByRole('button', { name: 'Import PDF' })).toBeEnabled();
});
