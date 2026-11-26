import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../core/storage/db';
import type { SpaceTransform } from '../../core/ink/geometry';
import type { TextMarkRecord } from '../../core/storage/types';

export const MARK_COLORS = [
  { name: 'Yellow', value: '#f5c842' },
  { name: 'Green', value: '#7cc47f' },
  { name: 'Blue', value: '#6aa9e9' },
  { name: 'Pink', value: '#ef8fb4' },
] as const;

export function colorName(hex: string) {
  return MARK_COLORS.find((c) => c.value === hex)?.name ?? 'Custom';
}

/** Each rendered page registers its PDF transform so a text selection can be stored in PDF space. */
export const pageTransforms = new WeakMap<Element, SpaceTransform>();

export type Box = [number, number, number, number];

/**
 * Merge the client rects of a selection into one box per line run, in CSS px relative to
 * the page. Rects from transparent text-layer spans overlap and repeat, so tiny boxes are
 * dropped and neighbours on the same line are joined.
 */
export function mergeLineBoxes(rects: Box[]): Box[] {
  const boxes = rects.filter((r) => r[2] - r[0] >= 1 && r[3] - r[1] >= 1).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const lines: Box[] = [];
  for (const r of boxes) {
    const h = r[3] - r[1];
    const line = lines.find((l) => {
      const overlap = Math.min(l[3], r[3]) - Math.max(l[1], r[1]);
      const gap = Math.max(l[0], r[0]) - Math.min(l[2], r[2]);
      return overlap > 0.5 * Math.min(h, l[3] - l[1]) && gap < Math.max(h, l[3] - l[1]);
    });
    if (line) {
      line[0] = Math.min(line[0], r[0]);
      line[1] = Math.min(line[1], r[1]);
      line[2] = Math.max(line[2], r[2]);
      line[3] = Math.max(line[3], r[3]);
    } else lines.push([...r]);
  }
  return lines;
}

/** CSS box inside the page -> PDF user space box (rotation safe). */
export function toPdfBox(t: SpaceTransform, b: Box): Box {
  const [ax, ay] = t.toCanonical(b[0], b[1]);
  const [bx, by] = t.toCanonical(b[2], b[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** PDF user space box -> CSS box inside the page. */
export function toViewBox(t: SpaceTransform, b: Box): Box {
  const [ax, ay] = t.toView(b[0], b[1]);
  const [bx, by] = t.toView(b[2], b[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export interface PendingSelection {
  pageIndex: number;
  rects: Box[];
  text: string;
  /** Viewport position for the toolbar. */
  anchor: { x: number; top: number; bottom: number };
}

/** Read the current DOM selection if it lies in one page's text layer. */
export function readSelection(root: HTMLElement): PendingSelection | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const startPage = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('.folio-page');
  if (!el || !startPage || !root.contains(startPage) || startPage.classList.contains('folio-prefetch')) return null;
  if (!startPage.querySelector('.textLayer')?.contains(range.startContainer)) return null;
  const t = pageTransforms.get(startPage);
  if (!t) return null;
  const pr = startPage.getBoundingClientRect();
  const css: Box[] = [];
  for (const r of range.getClientRects()) {
    // Clip to this page: a drag past its edge must not mark the next page.
    const x0 = Math.max(r.left, pr.left), y0 = Math.max(r.top, pr.top), x1 = Math.min(r.right, pr.right), y1 = Math.min(r.bottom, pr.bottom);
    if (x1 > x0 && y1 > y0) css.push([x0 - pr.left, y0 - pr.top, x1 - pr.left, y1 - pr.top]);
  }
  const lines = mergeLineBoxes(css);
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (!lines.length || !text) return null;
  const top = Math.min(...lines.map((l) => l[1])) + pr.top;
  const bottom = Math.max(...lines.map((l) => l[3])) + pr.top;
  const first = lines[0]!;
  return {
    pageIndex: Number(startPage.dataset.pageIndex),
    rects: lines.map((l) => toPdfBox(t, l)),
    text,
    anchor: { x: pr.left + (first[0] + first[2]) / 2, top, bottom },
  };
}

/** Live text marks for a book, grouped by page. */
export function useTextMarks(bookId: string) {
  const list = useLiveQuery(() => getDb().textMarks.where('bookId').equals(bookId).toArray(), [bookId]);
  return useMemo(() => {
    const byPage = new Map<number, TextMarkRecord[]>();
    for (const m of list ?? []) {
      const arr = byPage.get(m.pageIndex) ?? [];
      arr.push(m);
      byPage.set(m.pageIndex, arr);
    }
    return { list: list ?? [], byPage, loaded: list !== undefined };
  }, [list]);
}
