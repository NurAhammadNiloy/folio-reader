import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const FIXTURES = join(process.cwd(), 'tests/fixtures/generated');

export function ensureFixtures() {
  if (!existsSync(join(FIXTURES, 'geometry.pdf'))) {
    execFileSync('node', ['scripts/generate-fixtures.mjs', FIXTURES], { stdio: 'inherit' });
  }
}

export function fixture(name: string): Uint8Array {
  ensureFixtures();
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

export async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  return pdfjs;
}

export async function openFixture(name: string) {
  const pdfjs = await loadPdfjs();
  const standardFontDataUrl = join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/');
  const task = pdfjs.getDocument({ data: fixture(name), standardFontDataUrl, useSystemFonts: false });
  const doc = await task.promise;
  return Object.assign(doc, { close: () => task.destroy() });
}

export function hasBinary(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
