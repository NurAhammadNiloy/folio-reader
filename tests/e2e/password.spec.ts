import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { freshApp, watchPage } from './helpers';

// Synthetic fixture (RC4-128, user password "folio-test"), committed because the
// fixture generator's pdf-lib cannot encrypt.
const ENCRYPTED = join(process.cwd(), 'tests/fixtures/static/encrypted.pdf');

test('password-protected PDF: prompt, wrong password, open, never stored, export flagged', async ({ page }) => {
  const w = watchPage(page);
  await freshApp(page);
  await page.getByTestId('import-input').setInputFiles(ENCRYPTED);
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill('wrong');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(dialog).toContainText('That password was not correct');
  await dialog.getByLabel('Password').fill('folio-test');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('import-row').last()).toContainText('Added to library', { timeout: 30_000 });

  // The password is not persisted anywhere in IndexedDB.
  const leaked = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('folio'); q.onsuccess = () => r(q.result); });
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    let found = false;
    for (const n of names) {
      const all = await new Promise<unknown[]>((r) => { const q = tx.objectStore(n).getAll(); q.onsuccess = () => r(q.result); });
      if (JSON.stringify(all).includes('folio-test')) found = true;
    }
    return found;
  });
  expect(leaked).toBe(false);

  const card = page.getByRole('article').first();
  await card.getByRole('button', { name: /More actions/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Annotated export unavailable (encrypted PDF)' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Reopening asks again.
  await page.reload();
  await page.getByRole('article').first().getByRole('link', { name: /^Open / }).click();
  const gate = page.getByRole('dialog', { name: 'Password required' });
  await gate.getByLabel('Password').fill('folio-test');
  await gate.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.folio-page canvas.page-canvas').first()).toBeVisible();
  expect(w.external).toEqual([]);
});
