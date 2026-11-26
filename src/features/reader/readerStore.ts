import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { PageDescriptor } from '../../core/documents/pdfEngine';
import type { InkStyle, ReadingDirection, ViewMode, ViewerPrefs, ZoomMode } from '../../core/storage/types';
import { LIMITS } from '../../core/security/limits';

export type Tool = 'read' | 'draw' | 'erase';
export type Panel = null | 'outline' | 'thumbs' | 'search' | 'bookmarks';

export interface SearchHit {
  pageIndex: number;
  /** character offset of the match in the page's concatenated text */
  start: number;
  length: number;
  snippet: string;
}

export interface ReaderState {
  numPages: number;
  pages: (PageDescriptor | null)[];
  defaultSize: { width: number; height: number };
  labels: string[] | null;
  current: number;
  viewMode: ViewMode;
  zoomMode: ZoomMode;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  coverAlone: boolean;
  direction: ReadingDirection;
  chrome: boolean;
  panel: Panel;
  tool: Tool;
  pen: InkStyle;
  highlighter: InkStyle;
  activeInk: 'pen' | 'highlighter';
  strokeActive: boolean;
  /** Imperative navigation request consumed by views. */
  nav: { pageIndex: number; yFraction: number; seq: number; smooth: boolean } | null;
  search: { query: string; hits: SearchHit[]; active: number; running: boolean; scanned: number };
  noText: Record<number, boolean>;
  turnDir: 1 | -1;
}

export interface ReaderActions {
  init: (numPages: number, first: PageDescriptor, prefs: ViewerPrefs | null, direction: ReadingDirection) => void;
  setPages: (updates: PageDescriptor[]) => void;
  setLabels: (labels: string[] | null) => void;
  setCurrent: (i: number) => void;
  goTo: (i: number, yFraction?: number, smooth?: boolean) => void;
  next: () => void;
  prev: () => void;
  set: (p: Partial<ReaderState>) => void;
  zoomBy: (factor: number, currentScale: number) => void;
  prefs: () => ViewerPrefs;
  label: (i: number) => string;
}

export type ReaderStore = StoreApi<ReaderState & ReaderActions>;

/** Indexes shown together in spread view for a given page. */
export function spreadFor(i: number, n: number, coverAlone: boolean): number[] {
  if (coverAlone) {
    if (i === 0) return [0];
    const left = i % 2 === 1 ? i : i - 1;
    return left + 1 < n ? [left, left + 1] : [left];
  }
  const left = i % 2 === 0 ? i : i - 1;
  return left + 1 < n ? [left, left + 1] : [left];
}

export function createReaderStore(): ReaderStore {
  let seq = 0;
  return createStore<ReaderState & ReaderActions>((set, get) => ({
    numPages: 0,
    pages: [],
    defaultSize: { width: 595, height: 842 },
    labels: null,
    current: 0,
    viewMode: 'single',
    zoomMode: 'fitPage',
    zoom: 1,
    rotation: 0,
    coverAlone: true,
    direction: 'ltr',
    chrome: true,
    panel: null,
    tool: 'read',
    pen: { tool: 'pen', color: '#1f3a8a', width: 1.6, opacity: 1 },
    highlighter: { tool: 'highlighter', color: '#f2c94c', width: 12, opacity: 0.35 },
    activeInk: 'pen',
    strokeActive: false,
    nav: null,
    search: { query: '', hits: [], active: -1, running: false, scanned: 0 },
    noText: {},
    turnDir: 1,

    init: (numPages, first, prefs, direction) => {
      const pages: (PageDescriptor | null)[] = new Array(numPages).fill(null);
      pages[0] = first;
      set({
        numPages,
        pages,
        defaultSize: { width: first.width, height: first.height },
        direction,
        ...(prefs
          ? {
              viewMode: prefs.viewMode,
              zoomMode: prefs.zoomMode,
              zoom: clampZoom(prefs.zoom),
              rotation: prefs.rotation,
              coverAlone: prefs.coverAlone,
            }
          : {}),
      });
    },
    setPages: (updates) =>
      set((s) => {
        const pages = s.pages.slice();
        for (const u of updates) pages[u.index] = u;
        return { pages };
      }),
    setLabels: (labels) => set({ labels }),
    setCurrent: (i) => {
      if (i !== get().current) set({ current: i });
    },
    goTo: (i, yFraction = 0, smooth = false) => {
      const s = get();
      if (s.strokeActive || s.numPages === 0) return; // never navigate mid-stroke
      const target = Math.max(0, Math.min(s.numPages - 1, i));
      set({ current: target, nav: { pageIndex: target, yFraction, seq: ++seq, smooth }, turnDir: target >= s.current ? 1 : -1 });
    },
    next: () => {
      const s = get();
      if (s.viewMode === 'spread') {
        const sp = spreadFor(s.current, s.numPages, s.coverAlone);
        s.goTo(sp[sp.length - 1]! + 1);
      } else s.goTo(s.current + 1);
    },
    prev: () => {
      const s = get();
      if (s.viewMode === 'spread') {
        const sp = spreadFor(s.current, s.numPages, s.coverAlone);
        const prevSpread = spreadFor(Math.max(0, sp[0]! - 1), s.numPages, s.coverAlone);
        s.goTo(prevSpread[0]!);
      } else s.goTo(s.current - 1);
    },
    set: (p) => set(p),
    zoomBy: (factor, currentScale) => set({ zoomMode: 'custom', zoom: clampZoom(currentScale * factor) }),
    prefs: () => {
      const s = get();
      return { viewMode: s.viewMode, zoomMode: s.zoomMode, zoom: s.zoom, rotation: s.rotation, coverAlone: s.coverAlone };
    },
    label: (i) => {
      const l = get().labels?.[i];
      return l && l.trim() ? l : String(i + 1);
    },
  }));
}

export function clampZoom(z: number) {
  if (!Number.isFinite(z)) return 1;
  return Math.min(LIMITS.zoomMax, Math.max(LIMITS.zoomMin, z));
}

export function useReader<T>(store: ReaderStore, selector: (s: ReaderState & ReaderActions) => T): T {
  return useStore(store, selector);
}
