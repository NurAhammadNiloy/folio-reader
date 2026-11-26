import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, hasBinary, openFixture } from './helpers';
import { pdfTransform } from '../../src/core/ink/geometry';
import { exportAnnotatedPdf } from '../../src/core/export/annotatedPdf';
import type { AnnotationRecord } from '../../src/core/storage/types';
import { sha256Hex } from '../../src/core/security/hash';

// Independent check (spec 12.6): marks placed through PDF.js viewport inverse transforms
// are exported with pdf-lib and rendered by Poppler (pdftoppm), a different PDF engine.
// The rendered mark must land within 2 px of the screen position where it was "drawn".

function readPpm(path: string) {
  const buf = readFileSync(path);
  let pos = 0;
  const tokens: string[] = [];
  while (tokens.length < 4) {
    while (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09) pos++;
    if (buf[pos] === 0x23) {
      while (buf[pos] !== 0x0a) pos++;
      continue;
    }
    let t = '';
    while (buf[pos]! > 0x20) t += String.fromCharCode(buf[pos++]!);
    tokens.push(t);
  }
  pos++;
  const [magic, w, h] = [tokens[0], Number(tokens[1]), Number(tokens[2])];
  if (magic !== 'P6') throw new Error('expected P6');
  return { w, h, px: (x: number, y: number) => [buf[pos + (y * w + x) * 3]!, buf[pos + (y * w + x) * 3 + 1]!, buf[pos + (y * w + x) * 3 + 2]!] };
}

const runIf = hasBinary('pdftoppm') ? it : it.skip;

describe('annotated export alignment (independent renderer)', () => {
  runIf('places marks within 2 px on rotated, cropped and mixed-size pages', async () => {
    const DPI = 144;
    const scale = DPI / 72;
    const doc = await openFixture('geometry.pdf');
    const annotations: AnnotationRecord[] = [];
    const targets: { page: number; sx: number; sy: number }[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale }); // intrinsic rotation, like Poppler
      const t = pdfTransform(vp);
      for (const [fx, fy] of [[0.3, 0.6], [0.75, 0.2]] as const) {
        const sx = Math.round(vp.width * fx);
        const sy = Math.round(vp.height * fy);
        const [x, y] = t.toCanonical(sx, sy);
        const r = 4; // half-size in PDF units
        annotations.push({
          id: `a${i}-${fx}`,
          bookId: 'b',
          pageIndex: i,
          type: 'ink',
          points: [{ x, y, p: 0.5 }],
          outline: [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]],
          style: { tool: 'pen', color: '#0000ff', width: 8, opacity: 1 },
          createdAt: i,
          updatedAt: i,
        });
        targets.push({ page: i, sx, sy });
      }
    }
    await doc.close();

    const original = fixture('geometry.pdf');
    const beforeHash = await sha256Hex(original);
    const out = await exportAnnotatedPdf(original, annotations);
    expect(await sha256Hex(original)).toBe(beforeHash); // input bytes untouched

    const dir = mkdtempSync(join(tmpdir(), 'folio-export-'));
    writeFileSync(join(dir, 'out.pdf'), out);
    // -cropbox: render the visible (crop) box like PDF viewers do; pdftoppm defaults to MediaBox.
    execFileSync('pdftoppm', ['-cropbox', '-r', String(DPI), join(dir, 'out.pdf'), join(dir, 'p')]);
    if (process.env.FOLIO_DEBUG_DIR) writeFileSync(join(process.env.FOLIO_DEBUG_DIR, 'export-out.pdf'), out);

    const totalPages = new Set(targets.map((t) => t.page)).size;
    for (const tgt of targets) {
      const num = String(tgt.page + 1).padStart(String(totalPages).length, '0');
      const img = readPpm(join(dir, `p-${num}.ppm`));
      // centroid of blue pixels in a 40px window around the target
      let sx = 0, sy = 0, n = 0;
      for (let y = Math.max(0, tgt.sy - 20); y < Math.min(img.h, tgt.sy + 20); y++)
        for (let x = Math.max(0, tgt.sx - 20); x < Math.min(img.w, tgt.sx + 20); x++) {
          const [r, g, b] = img.px(x, y);
          if (b > 200 && r < 60 && g < 60) { sx += x; sy += y; n++; }
        }
      expect(n, `page ${tgt.page + 1} mark present`).toBeGreaterThan(20);
      expect(Math.abs(sx / n - tgt.sx), `page ${tgt.page + 1} x`).toBeLessThanOrEqual(2);
      expect(Math.abs(sy / n - tgt.sy), `page ${tgt.page + 1} y`).toBeLessThanOrEqual(2);
    }
  });

  it('refuses annotations that reference missing pages', async () => {
    await expect(
      exportAnnotatedPdf(fixture('single.pdf'), [
        { id: 'x', bookId: 'b', pageIndex: 5, type: 'ink', points: [], outline: [[0, 0], [1, 1], [2, 0]], style: { tool: 'pen', color: '#000000', width: 1, opacity: 1 }, createdAt: 0, updatedAt: 0 },
      ]),
    ).rejects.toMatchObject({ code: 'page-range' });
  });

  it('keeps original page content (no full-page flattening)', async () => {
    const out = await exportAnnotatedPdf(fixture('single.pdf'), [
      { id: 'x', bookId: 'b', pageIndex: 0, type: 'ink', points: [], outline: [[100, 100], [140, 100], [140, 140]], style: { tool: 'highlighter', color: '#f5d33b', width: 10, opacity: 0.35 }, createdAt: 0, updatedAt: 0 },
    ]);
    const doc = await (await import('./helpers')).loadPdfjs().then((p) => p.getDocument({ data: out }).promise);
    const page = await doc.getPage(1);
    const text = await page.getTextContent();
    const str = text.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(str).toContain('Folio fixture page 1');
  });
});
