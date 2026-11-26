// Self-host PDF.js CMaps, standard fonts, ICC profiles and WASM decoders that match the
// pinned pdfjs-dist version, so Unicode/CJK PDFs render offline with no CDN.
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = join('node_modules', 'pdfjs-dist');
const dest = join('public', 'pdfjs');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir);
  // Skip the QuickJS scripting sandbox: Folio never executes document JavaScript.
  if (existsSync(from))
    cpSync(from, join(dest, dir), { recursive: true, filter: (p) => !/quickjs/i.test(p) });
}
const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
writeFileSync(join(dest, 'VERSION'), version + '\n');
console.log(`Copied PDF.js ${version} assets to ${dest}`);
