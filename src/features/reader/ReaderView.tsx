import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../../core/documents/pdfEngine';
import { RenderBudget } from './renderBudget';
import { LIMITS } from '../../core/security/limits';
import { PageView, pageCssSize } from './PageView';
import { spreadFor, useReader, type ReaderStore } from './readerStore';
import type { BookInk } from '../ink/useBookInk';
import { ProgressRepository } from '../../core/storage/progressRepository';
import type { PdfLocation } from '../../core/storage/types';

export interface Visibility {
  /** page index -> { visible css px², page area, viewport area } */
  pages: Map<number, { visible: number; area: number }>;
  viewportArea: number;
}

const GAP = 16;
const PAD = 16;

export function ReaderView({
  store,
  doc,
  bookId,
  ink,
  fingerDraws,
  reducedMotion,
  visibilityRef,
  onToggleChrome,
}: {
  store: ReaderStore;
  doc: PDFDocumentProxy;
  bookId: string;
  ink: BookInk;
  fingerDraws: boolean;
  reducedMotion: boolean;
  visibilityRef: React.MutableRefObject<Visibility>;
  onToggleChrome: () => void;
}) {
  const s = useReader(store, (x) => x);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const budget = useMemo(() => new RenderBudget(LIMITS.renderCacheCanvases, LIMITS.renderCacheBytes, LIMITS.maxCanvasPixels), []);
  useEffect(() => () => budget.clear(), [budget]);
  const [visibleSet, setVisibleSet] = useState<Set<number>>(new Set([0]));

  // Container size
  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const n = s.numPages;
  const extra = s.rotation;
  const spread = s.viewMode === 'spread' ? spreadFor(s.current, n, s.coverAlone) : [s.current];

  // Effective CSS scale from zoom mode, based on the current page/spread.
  const scale = useMemo(() => {
    if (!box.w) return 1;
    if (s.zoomMode === 'custom') return s.zoom;
    const dims = spread.map((i) => pageCssSize(s.pages[i] ?? null, s.defaultSize, 1, extra));
    const rowW = dims.reduce((a, d) => a + d.width, 0) + (dims.length - 1) * GAP;
    const rowH = Math.max(...dims.map((d) => d.height));
    const fitW = (box.w - PAD * 2) / rowW;
    if (s.zoomMode === 'fitWidth') return clamp(fitW);
    return clamp(Math.min(fitW, (box.h - PAD * 2) / rowH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h, s.zoomMode, s.zoom, extra, s.pages, s.defaultSize, spread.join(',')]);

  // Publish effective scale for the toolbar
  useEffect(() => {
    (store as unknown as { effectiveScale?: number }).effectiveScale = scale;
    window.dispatchEvent(new CustomEvent('folio:scale', { detail: scale }));
  }, [scale, store]);

  // ----- visibility tracking (IntersectionObserver), current page in scroll mode -----
  useEffect(() => {
    const root = scroller.current!;
    const ratios = new Map<number, IntersectionObserverEntry>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.pageIndex);
          if (e.isIntersecting) ratios.set(idx, e);
          else ratios.delete(idx);
        }
        const vis = new Map<number, { visible: number; area: number }>();
        let best = -1;
        let bestArea = 0;
        for (const [idx, e] of ratios) {
          const visible = e.intersectionRect.width * e.intersectionRect.height;
          vis.set(idx, { visible, area: e.boundingClientRect.width * e.boundingClientRect.height });
          if (visible > bestArea) {
            bestArea = visible;
            best = idx;
          }
        }
        visibilityRef.current = { pages: vis, viewportArea: root.clientWidth * root.clientHeight };
        setVisibleSet(new Set(vis.keys()));
        if (store.getState().viewMode === 'scroll' && best >= 0 && !programmatic.current) store.getState().setCurrent(best);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1] },
    );
    const observe = () => {
      io.disconnect();
      ratios.clear();
      for (const el of content.current?.querySelectorAll<HTMLElement>('[data-page-index]') ?? [])
        if (!el.closest('[data-prefetch]')) io.observe(el);
    };
    observe();
    const mo = new MutationObserver(observe);
    mo.observe(content.current!, { childList: true, subtree: false });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [store, visibilityRef, s.viewMode, n]);

  // ----- imperative navigation -----
  const programmatic = useRef(false);
  const pageOffset = useCallback(
    (i: number) => {
      // scroll mode: sum of preceding heights + gaps
      let y = PAD;
      for (let k = 0; k < i; k++) y += pageCssSize(s.pages[k] ?? null, s.defaultSize, scale, extra).height + GAP;
      return y;
    },
    [s.pages, s.defaultSize, scale, extra],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !s.nav) return;
    if (s.viewMode === 'scroll') {
      const h = pageCssSize(s.pages[s.nav.pageIndex] ?? null, s.defaultSize, scale, extra).height;
      programmatic.current = true;
      el.scrollTo({ top: pageOffset(s.nav.pageIndex) + s.nav.yFraction * h - PAD, behavior: s.nav.smooth && !reducedMotion ? 'smooth' : 'auto' });
      setTimeout(() => (programmatic.current = false), s.nav.smooth ? 500 : 60);
    } else {
      const h = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: Math.max(0, s.nav.yFraction * h), left: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.nav?.seq]);

  // Keep position stable across zoom / rotation / mode changes in scroll mode.
  const lastLayout = useRef({ scale, extra, mode: s.viewMode });
  useLayoutEffect(() => {
    const prev = lastLayout.current;
    lastLayout.current = { scale, extra, mode: s.viewMode };
    if (prev.scale === scale && prev.extra === extra && prev.mode === s.viewMode) return;
    if (s.viewMode === 'scroll') store.getState().goTo(store.getState().current, currentFraction(), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, extra, s.viewMode]);

  const currentFraction = useCallback(() => {
    const el = scroller.current;
    if (!el) return 0;
    const st = store.getState();
    if (st.viewMode === 'scroll') {
      const top = lastLayoutOffset.current(st.current);
      const h = pageCssSize(st.pages[st.current] ?? null, st.defaultSize, lastScale.current, st.rotation).height;
      return h ? Math.min(1, Math.max(0, (el.scrollTop + PAD - top) / h)) : 0;
    }
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 0;
  }, [store]);
  const lastLayoutOffset = useRef(pageOffset);
  lastLayoutOffset.current = pageOffset;
  const lastScale = useRef(scale);
  lastScale.current = scale;

  // ----- persist resume location after navigation / settled scroll -----
  const saveTimer = useRef<number>(0);
  const saveNow = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const st = store.getState();
    if (!st.numPages) return;
    const el = scroller.current;
    const xMax = el ? el.scrollWidth - el.clientWidth : 0;
    const loc: PdfLocation = {
      kind: 'pdf',
      pageIndex: st.current,
      xFraction: el && xMax > 0 ? Math.min(1, el.scrollLeft / xMax) : 0,
      yFraction: Math.round(currentFraction() * 1000) / 1000,
    };
    void ProgressRepository.saveLocation(bookId, loc).catch(() => undefined);
  }, [bookId, currentFraction, store]);
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveNow, 400);
  }, [saveNow]);
  useEffect(scheduleSave, [s.current, scheduleSave]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && saveNow();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveNow);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveNow);
      saveNow();
    };
  }, [saveNow]);

  // ----- gestures: pinch zoom, ctrl+wheel zoom, swipe page turn -----
  const touches = useRef(new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>());
  const pinch = useRef<{ d0: number; ratio: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (touches.current.size === 2 && !store.getState().strokeActive) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { d0: Math.hypot(a!.x - b!.x, a!.y - b!.y), ratio: 1 };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      pinch.current.ratio = Math.max(LIMITS.zoomMin / scale, Math.min(LIMITS.zoomMax / scale, d / Math.max(1, pinch.current.d0)));
      if (content.current) {
        content.current.style.transformOrigin = 'center top';
        content.current.style.transform = `scale(${pinch.current.ratio})`;
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touches.current.get(e.pointerId);
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) {
        const r = pinch.current.ratio;
        pinch.current = null;
        if (content.current) content.current.style.transform = '';
        if (Math.abs(r - 1) > 0.03) store.getState().zoomBy(r, scale);
      }
      return;
    }
    if (!t || e.type === 'pointercancel') return;
    const st = store.getState();
    if (st.viewMode === 'scroll' || st.tool !== 'read' || st.strokeActive) return;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    const el = scroller.current!;
    const canPanX = el.scrollWidth > el.clientWidth + 2;
    if (!canPanX && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - t.t0 < 800) {
      const forward = dx < 0;
      if (forward !== (st.direction === 'rtl')) st.next();
      else st.prev();
    }
  };
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      store.getState().zoomBy(Math.exp(-e.deltaY * 0.01), lastScale.current);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store]);

  const onPan = useCallback((dx: number, dy: number) => scroller.current?.scrollBy(-dx, -dy), []);
  const onStrokeActive = useCallback((a: boolean) => store.getState().set({ strokeActive: a }), [store]);
  const onNoText = useCallback(
    (i: number, v: boolean) => {
      if (store.getState().noText[i] !== v) store.getState().set({ noText: { ...store.getState().noText, [i]: v } });
    },
    [store],
  );
  const inkStyle = s.activeInk === 'pen' ? s.pen : s.highlighter;
  const activeHit = s.search.active >= 0 ? s.search.hits[s.search.active] : undefined;

  const pageProps = (i: number, render: boolean, visible: boolean) => ({
    doc,
    index: i,
    desc: s.pages[i] ?? null,
    fallback: s.defaultSize,
    scale,
    extraRotation: extra,
    render,
    visible,
    budget,
    label: s.labels?.[i]?.trim() || String(i + 1),
    tool: s.tool,
    inkStyle,
    strokes: ink.byPage.get(i),
    fingerDraws,
    search: { query: s.search.query, activeStart: activeHit && activeHit.pageIndex === i ? activeHit.start : null },
    onNoText,
    onCommit: ink.commitStroke,
    onErase: ink.erase,
    onStrokeActive,
    onCheckpoint: ink.checkpoint,
    onPan,
  });

  const minVisible = visibleSet.size ? Math.min(...visibleSet) : s.current;
  const maxVisible = visibleSet.size ? Math.max(...visibleSet) : s.current;

  let body: React.ReactNode;
  if (s.viewMode === 'scroll') {
    body = (
      <div ref={content} className="flex flex-col items-center" style={{ gap: GAP, padding: PAD, minWidth: 'fit-content' }}>
        {Array.from({ length: n }, (_, i) => (
          <PageView key={i} {...pageProps(i, i >= minVisible - 1 && i <= maxVisible + 1, visibleSet.has(i))} />
        ))}
      </div>
    );
  } else {
    const ordered = s.direction === 'rtl' ? [...spread].reverse() : spread;
    const nextSpread = s.viewMode === 'spread' ? spreadFor(spread[spread.length - 1]! + 1, n, s.coverAlone) : [s.current + 1];
    const prevSpread = s.viewMode === 'spread' ? spreadFor(Math.max(0, spread[0]! - 1), n, s.coverAlone) : [s.current - 1];
    const prefetch = [...new Set([...nextSpread, ...prevSpread])].filter((i) => i >= 0 && i < n && !spread.includes(i));
    const turnFrom = (s.turnDir === 1) !== (s.direction === 'rtl') ? '14px' : '-14px';
    body = (
      <div
        ref={content}
        className="flex min-h-full items-center justify-center"
        style={{ padding: PAD, minWidth: 'fit-content' }}
        onClick={(e) => {
          if (e.target === e.currentTarget && s.tool === 'read') onToggleChrome();
        }}
      >
        <div
          key={spread.join('-')}
          className={`flex ${reducedMotion ? '' : 'page-turn'}`}
          style={{ gap: s.viewMode === 'spread' ? 2 : 0, ['--turn-from' as string]: turnFrom }}
          onClick={(e) => {
            if (e.target === e.currentTarget && s.tool === 'read') onToggleChrome();
          }}
        >
          {ordered.map((i) => (
            <PageView key={i} {...pageProps(i, true, true)} />
          ))}
        </div>
        <div aria-hidden className="pointer-events-none fixed -left-[99999px] top-0 h-0 w-0 overflow-hidden">
          {prefetch.map((i) => (
            <div key={i} data-prefetch>
              <PageView {...pageProps(i, true, false)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      className="relative h-full w-full overflow-auto bg-[var(--reader-bg)]"
      style={{ touchAction: s.tool === 'read' ? 'pan-x pan-y' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onScroll={scheduleSave}
      data-testid="reader-scroller"
    >
      {body}
    </div>
  );
}

function clamp(z: number) {
  return Math.min(LIMITS.zoomMax, Math.max(LIMITS.zoomMin, z));
}
