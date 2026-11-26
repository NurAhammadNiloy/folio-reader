import { describe, expect, it } from 'vitest';
import { openFixture } from './helpers';
import { pdfTransform, strokeHit, strokeOutline, simplify, clientToElement } from '../../src/core/ink/geometry';

// Spec 12.6: coordinate roundtrip tolerance <= 0.5 PDF user-space units for unrotated,
// 90/180/270 and cropped pages, mixed sizes and devicePixelRatio 1/2/3.
describe('canonical PDF coordinate roundtrip', () => {
  it('maps view -> PDF -> view within 0.5 units for every page, rotation, scale and DPR', async () => {
    const doc = await openFixture('geometry.pdf');
    let checked = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      for (const extra of [0, 90, 180, 270]) {
        for (const scale of [0.25, 1, 1.7, 4]) {
          for (const dpr of [1, 2, 3]) {
            const vp = page.getViewport({ scale, rotation: (page.rotate + extra) % 360 });
            const t = pdfTransform(vp);
            // Simulate a pointer at backing-store pixel (bx,by) on a DPR canvas: CSS = px / dpr.
            for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.5], [0.93, 0.27], [0.33, 0.88]] as const) {
              const bx = fx * vp.width * dpr;
              const by = fy * vp.height * dpr;
              const [cx, cy] = [bx / dpr, by / dpr];
              const [px, py] = t.toCanonical(cx, cy);
              const [vx, vy] = t.toView(px, py);
              // tolerance converted to PDF units
              expect(Math.abs(vx - cx) / t.scale).toBeLessThanOrEqual(0.5);
              expect(Math.abs(vy - cy) / t.scale).toBeLessThanOrEqual(0.5);
              // canonical point lies inside the page's view box (crop box)
              const [x0, y0, x1, y1] = page.view as number[];
              expect(px).toBeGreaterThanOrEqual(x0! - 0.5);
              expect(px).toBeLessThanOrEqual(x1! + 0.5);
              expect(py).toBeGreaterThanOrEqual(y0! - 0.5);
              expect(py).toBeLessThanOrEqual(y1! + 0.5);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(6 * 4 * 4 * 3 * 4);
    await doc.close();
  });

  it('canonical points are independent of zoom and rotation', async () => {
    const doc = await openFixture('geometry.pdf');
    const page = await doc.getPage(6); // rotated, cropped, offset media box
    const canonical: [number, number] = [120, 300];
    const seen: [number, number][] = [];
    for (const extra of [0, 90, 180, 270]) {
      for (const scale of [0.5, 2]) {
        const t = pdfTransform(page.getViewport({ scale, rotation: (page.rotate + extra) % 360 }));
        const [vx, vy] = t.toView(...canonical);
        seen.push(t.toCanonical(vx, vy));
      }
    }
    for (const [x, y] of seen) {
      expect(Math.abs(x - canonical[0])).toBeLessThan(1e-6);
      expect(Math.abs(y - canonical[1])).toBeLessThan(1e-6);
    }
    await doc.close();
  });

  it('clientToElement accounts for CSS transforms of the page element', () => {
    // Element is 400x600 logical px but visually scaled to 200x300 at (10,20).
    const [x, y] = clientToElement(110, 170, { left: 10, top: 20, width: 200, height: 300 }, 400, 600);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(300);
  });
});

describe('stroke geometry', () => {
  const style = { tool: 'pen' as const, color: '#1d3b8a', width: 3, opacity: 1 };
  const pts = Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 5, y: 200 + Math.sin(i / 3) * 10, p: 0.5 }));

  it('builds a closed outline in canonical units around the input points', () => {
    const outline = strokeOutline(pts, style);
    expect(outline.length).toBeGreaterThan(10);
    const xs = outline.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(90);
    expect(Math.max(...xs)).toBeLessThan(210);
  });

  it('whole-stroke eraser hit test respects width and radius', () => {
    expect(strokeHit(pts, 3, 150, 200 + Math.sin(10 / 3) * 10, 1)).toBe(true);
    expect(strokeHit(pts, 3, 150, 260, 2)).toBe(false);
  });

  it('simplify keeps endpoints and reduces dense input', () => {
    const dense = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.05, y: 0, p: 0.5 }));
    const s = simplify(dense, 0.5);
    expect(s[0]).toEqual(dense[0]);
    expect(s[s.length - 1]).toEqual(dense[dense.length - 1]);
    expect(s.length).toBeLessThan(30);
  });
});
