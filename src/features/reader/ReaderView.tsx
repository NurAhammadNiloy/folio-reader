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
  const reobserve = useRef<(() => void) | null>(null);
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
        if (!el.classList.contains('folio-prefetch')) io.observe(el);
    };
    observe();
    reobserve.current = observe;
    const mo = new MutationObserver(observe);
    mo.observe(content.current!, { childList: true, subtree: false });
    return () => {
      reobserve.current = null;
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
  // Paged navigation is a deliberate move: persist it at once so a reload right
  // after a jump resumes there. Scroll mode changes `current` continuously, so
  // it stays debounced.
  const currentPage = s.current;
  useEffect(() => {
    void currentPage; // re-run on every page change
    if (store.getState().viewMode === 'scroll') {
      scheduleSave();
      return;
    }
    const raf = requestAnimationFrame(saveNow);
    return () => cancelAnimationFrame(raf);
  }, [currentPage, scheduleSave, saveNow, store]);
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
  // Touch events, not pointer events: with native panning allowed (touch-action
  // pan-x pan-y) the browser sends pointercancel as soon as a finger moves, which
  // swallowed swipes and pinches. Touch events keep flowing. Apple Pencil touches
  // (touchType "stylus") are ignored here; ink handles the pen.
  const swipe = useRef<{ x0: number; y0: number; t0: number } | null>(null);
  const pinch = useRef<{ d0: number; ratio: number } | null>(null);
  const fingers = (e: React.TouchEvent) => Array.from(e.touches).filter((t) => (t as Touch & { touchType?: string }).touchType !== 'stylus');
  const onTouchStart = (e: React.TouchEvent) => {
    const f = fingers(e);
    if (f.length === 1) swipe.current = { x0: f[0]!.clientX, y0: f[0]!.clientY, t0: performance.now() };
    else swipe.current = null;
    if (f.length === 2 && !store.getState().strokeActive) {
      pinch.current = { d0: Math.hypot(f[0]!.clientX - f[1]!.clientX, f[0]!.clientY - f[1]!.clientY), ratio: 1 };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const f = fingers(e);
    if (pinch.current && f.length === 2) {
      const d = Math.hypot(f[0]!.clientX - f[1]!.clientX, f[0]!.clientY - f[1]!.clientY);
      pinch.current.ratio = Math.max(LIMITS.zoomMin / scale, Math.min(LIMITS.zoomMax / scale, d / Math.max(1, pinch.current.d0)));
      if (content.current) {
        content.current.style.transformOrigin = 'center top';
        content.current.style.transform = `scale(${pinch.current.ratio})`;
      }
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (pinch.current) {
      if (fingers(e).length < 2) {
        const r = pinch.current.ratio;
        pinch.current = null;
        if (content.current) content.current.style.transform = '';
        if (Math.abs(r - 1) > 0.03) store.getState().zoomBy(r, scale);
      }
      swipe.current = null;
      return;
    }
    const t = swipe.current;
    swipe.current = null;
    const end = Array.from(e.changedTouches).find((c) => (c as Touch & { touchType?: string }).touchType !== 'stylus');
    if (!t || !end || e.type === 'touchcancel') return;
    const st = store.getState();
    if (st.viewMode === 'scroll' || st.tool !== 'read' || st.strokeActive) return;
    const dx = end.clientX - t.x0;
    const dy = end.clientY - t.y0;
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

  // Page-turn motion without remounting the pages (remounting threw away the prefetched canvas).
  const turnRow = useRef<HTMLDivElement>(null);
  const spreadKey = s.viewMode === 'scroll' ? '' : spread.join('-');
  const firstTurn = useRef(true);
  useLayoutEffect(() => {
    if (firstTurn.current || !spreadKey) {
      firstTurn.current = false;
      return;
    }
    const el = turnRow.current;
    if (!el || reducedMotion || typeof el.animate !== 'function') return;
    const st = store.getState();
    const from = (st.turnDir === 1) !== (st.direction === 'rtl') ? 14 : -14;
    el.animate([{ opacity: 0.35, transform: `translateX(${from}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }, [spreadKey, reducedMotion, store]);
  // Pages stay mounted across turns now, so re-select which ones count as on screen.
  useEffect(() => reobserve.current?.(), [spreadKey]);

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
    searchQuery: s.search.query,
    searchActiveStart: activeHit && activeHit.pageIndex === i ? activeHit.start : null,
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
    body = (
      <div
        ref={content}
        className="flex min-h-full items-center justify-center"
        style={{ padding: PAD, minWidth: 'fit-content' }}
        onClick={(e) => {
          if (e.target === e.currentTarget && s.tool === 'read') onToggleChrome();
        }}
      >
        {/* One stable parent keyed by page, so a prefetched page keeps its canvas when it becomes visible. */}
        <div
          ref={turnRow}
          data-testid="visible-pages"
          className="flex"
          style={{ gap: s.viewMode === 'spread' ? 2 : 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && s.tool === 'read') onToggleChrome();
          }}
        >
          {ordered.map((i) => (
            <PageView key={i} {...pageProps(i, true, true)} />
          ))}
          {prefetch.map((i) => (
            <PageView key={i} {...pageProps(i, true, false)} className="folio-prefetch" />
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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
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
