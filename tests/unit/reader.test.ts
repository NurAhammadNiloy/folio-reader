import { describe, expect, it } from 'vitest';
import { RenderBudget } from '../../src/features/reader/renderBudget';
import { InkHistory } from '../../src/core/ink/history';
import { createReaderStore, spreadFor } from '../../src/features/reader/readerStore';

describe('render budget', () => {
  it('never exceeds the canvas count and evicts least recently used hidden pages', () => {
    const b = new RenderBudget(6, 64 * 1024 * 1024, 8_000_000);
    const evicted: number[] = [];
    for (let i = 0; i < 10; i++) b.reserve(i, 600, 800, 2, false, () => evicted.push(i));
    expect(b.count).toBeLessThanOrEqual(6);
    expect(evicted.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(b.totalBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
  it('caps a single canvas at 8 MP and downscales instead of evicting visible pages', () => {
    const b = new RenderBudget(6, 64 * 1024 * 1024, 8_000_000);
    const r = b.reserve(0, 3000, 4000, 2, true, () => undefined);
    expect(3000 * 4000 * r * r).toBeLessThanOrEqual(8_000_000 * 1.01);
    let evictedVisible = false;
    for (let i = 1; i < 6; i++) b.reserve(i, 2000, 2800, 2, true, () => (evictedVisible = true));
    expect(evictedVisible).toBe(false);
    expect(b.totalBytes).toBeLessThanOrEqual(64 * 1024 * 1024 + 2000 * 2800 * 4);
  });
});

describe('undo history', () => {
  it('is capped, reversible and clears redo on new edits', () => {
    const h = new InkHistory<number>(3);
    for (let i = 0; i < 5; i++) h.push({ kind: 'add', strokes: [i] });
    expect(h.size).toBe(3);
    expect(h.peekUndo()).toEqual({ kind: 'remove', strokes: [4] });
    h.commitUndo();
    expect(h.peekRedo()).toEqual({ kind: 'add', strokes: [4] });
    h.push({ kind: 'remove', strokes: [9] });
    expect(h.canRedo).toBe(false);
  });
});

describe('reader controller', () => {
  it('computes spreads with and without a separate cover', () => {
    expect(spreadFor(0, 10, true)).toEqual([0]);
    expect(spreadFor(1, 10, true)).toEqual([1, 2]);
    expect(spreadFor(2, 10, true)).toEqual([1, 2]);
    expect(spreadFor(0, 10, false)).toEqual([0, 1]);
    expect(spreadFor(9, 10, false)).toEqual([8, 9]);
    expect(spreadFor(9, 10, true)).toEqual([9]);
  });
  it('does not navigate while a stroke is active and clamps targets', () => {
    const s = createReaderStore();
    s.getState().init(10, { index: 0, width: 600, height: 800, rotate: 0, view: [0, 0, 600, 800], userUnit: 1 }, null, 'ltr');
    s.getState().goTo(3);
    expect(s.getState().current).toBe(3);
    s.getState().set({ strokeActive: true });
    s.getState().next();
    expect(s.getState().current).toBe(3);
    s.getState().set({ strokeActive: false });
    s.getState().goTo(99);
    expect(s.getState().current).toBe(9);
    s.getState().set({ viewMode: 'spread' });
    s.getState().goTo(1);
    s.getState().next();
    expect(s.getState().current).toBe(3);
    s.getState().prev();
    expect(s.getState().current).toBe(1);
  });
});
