// Canonical ink geometry (spec 5, 12.3). Points are stored in PDF user space for book
// pages (unrotated, bottom-left origin, crop-box offsets retained) or in notebook
// virtual units for notebook pages. Screen pixels are never authoritative.
import { getStroke } from 'perfect-freehand';
import type { InkStyle, StrokePoint } from '../storage/types';

/** Minimal viewport contract shared by PDF.js PageViewport and the notebook adapter. */
export interface SpaceTransform {
  /** canonical -> CSS px inside the page element */
  toView(x: number, y: number): [number, number];
  /** CSS px inside the page element -> canonical */
  toCanonical(x: number, y: number): [number, number];
  /** CSS px per canonical unit (uniform). */
  scale: number;
}

interface PdfJsViewportLike {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
  scale: number;
  userUnit?: number;
}

export function pdfTransform(vp: PdfJsViewportLike): SpaceTransform {
  return {
    toView: (x, y) => {
      const p = vp.convertToViewportPoint(x, y);
      return [p[0]!, p[1]!];
    },
    toCanonical: (x, y) => {
      const p = vp.convertToPdfPoint(x, y);
      return [p[0]!, p[1]!];
    },
    scale: vp.scale * (vp.userUnit ?? 1),
  };
}

/** Notebook pages use a top-left origin virtual space (A4 = 595 x 842 units). */
export function notebookTransform(scale: number): SpaceTransform {
  return {
    toView: (x, y) => [x * scale, y * scale],
    toCanonical: (x, y) => [x / scale, y / scale],
    scale,
  };
}

/**
 * Map a pointer event's client coordinates into CSS px inside the page element using
 * measured bounds (handles CSS transforms such as a pinch preview).
 */
export function clientToElement(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  logicalWidth: number,
  logicalHeight: number,
): [number, number] {
  const sx = rect.width ? logicalWidth / rect.width : 1;
  const sy = rect.height ? logicalHeight / rect.height : 1;
  return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
}

export function normalisePressure(pointerType: string, pressure: number): number {
  // Mouse reports 0.5 while pressed; touch often reports 0 or 1 without real data.
  if (pointerType === 'pen' && pressure > 0 && pressure <= 1) return pressure;
  return 0.5;
}

/** Build the stroke outline polygon in canonical space. */
export function strokeOutline(points: StrokePoint[], style: InkStyle): [number, number][] {
  if (points.length === 0) return [];
  const highlighter = style.tool === 'highlighter';
  const input = points.map((p) => [p.x, p.y, p.p] as [number, number, number]);
  const outline = getStroke(input, {
    size: style.width,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: false,
    last: true,
    start: { cap: !highlighter },
    end: { cap: !highlighter },
  });
  return outline.map(([x, y]) => [round3(x!), round3(y!)] as [number, number]);
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Simplify a point list (radial distance) to bound storage, keeping first and last. */
export function simplify(points: StrokePoint[], minDist: number): StrokePoint[] {
  if (points.length <= 2) return points;
  const out: StrokePoint[] = [points[0]!];
  let last = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) {
      out.push(p);
      last = p;
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whole-stroke eraser hit test in canonical space. */
export function strokeHit(points: StrokePoint[], width: number, x: number, y: number, radius: number): boolean {
  const tol = width / 2 + radius;
  if (points.length === 1) return Math.hypot(points[0]!.x - x, points[0]!.y - y) <= tol;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= tol) return true;
  }
  return false;
}

/** All coordinates finite (used to validate restored data). */
export function finitePoints(points: StrokePoint[]): boolean {
  return points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.p));
}

/** Paint a canonical outline onto a 2D context whose transform maps CSS px. */
export function paintOutline(
  ctx: CanvasRenderingContext2D,
  outline: [number, number][],
  t: SpaceTransform,
  style: InkStyle,
) {
  if (outline.length < 2) return;
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.fillStyle = style.color;
  if (style.tool === 'highlighter') ctx.globalCompositeOperation = 'multiply';
  ctx.beginPath();
  const [x0, y0] = t.toView(outline[0]![0], outline[0]![1]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < outline.length; i++) {
    const [x, y] = t.toView(outline[i]![0], outline[i]![1]);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
