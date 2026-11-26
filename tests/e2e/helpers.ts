import { expect, type Page, type ConsoleMessage } from '@playwright/test';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const FIXTURES = join(process.cwd(), 'tests/fixtures/generated');

export function fixturePath(name: string) {
  if (!existsSync(join(FIXTURES, 'text-12p.pdf'))) execFileSync('node', ['scripts/generate-fixtures.mjs', FIXTURES], { stdio: 'inherit' });
  return join(FIXTURES, name);
}

/** Collect console errors, CSP violations and failed requests for a page. */
export function watchPage(page: Page) {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('blob') && !u.protocol.startsWith('data') && u.origin !== new URL(page.url() || 'http://localhost').origin)
      external.push(r.url());
  });
  return { errors, external };
}

export async function freshApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
}

export async function importFiles(page: Page, ...names: string[]) {
  await page.getByTestId('import-input').setInputFiles(names.map(fixturePath));
}

export async function importAndWait(page: Page, name: string) {
  await importFiles(page, name);
  await expect(page.getByTestId('import-row').last()).toContainText(/Added to library|Already in your library/, { timeout: 30_000 });
}
