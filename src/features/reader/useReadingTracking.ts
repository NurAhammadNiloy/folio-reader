import { useEffect, useRef } from 'react';
import { ProgressRepository } from '../../core/storage/progressRepository';
import type { Visibility } from './ReaderView';

/**
 * Progress semantics (spec 12.6). A page qualifies after being continuously visible at
 * >= 50% of min(page area, viewport area) for `qualifySeconds` while the document is
 * visible. Session time is an estimate: it accumulates on a monotonic clock only while
 * the tab is visible and within `idleSeconds` of the last interaction, and is
 * checkpointed every 15 s. Nothing here claims verified reading.
 */
export function useReadingTracking(
  bookId: string,
  visibilityRef: React.MutableRefObject<Visibility>,
  opts: { qualifySeconds: number; idleSeconds: number; enabled: boolean },
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;
    let lastInteraction = performance.now();
    let lastTick = performance.now();
    let sessionId: string | null = null;
    let starting = false;
    let activeMs = 0;
    let lastCheckpoint = performance.now();
    const continuous = new Map<number, number>();
    const pendingQualified = new Set<number>();
    const reported = new Set<number>();
    let flushTimer = 0;

    const onInteract = () => {
      lastInteraction = performance.now();
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const ev of events) window.addEventListener(ev, onInteract, { passive: true });
    window.addEventListener('scroll', onInteract, { passive: true, capture: true });

    const flushQualified = () => {
      if (!pendingQualified.size) return;
      const pages = [...pendingQualified];
      pendingQualified.clear();
      void ProgressRepository.addQualifiedPages(bookId, pages).catch(() => pages.forEach((p) => pendingQualified.add(p)));
    };
    const checkpoint = () => {
      if (sessionId) void ProgressRepository.checkpointSession(sessionId, activeMs).catch(() => undefined);
      lastCheckpoint = performance.now();
    };

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(5000, now - lastTick);
      lastTick = now;
      const visible = document.visibilityState === 'visible' && document.hasFocus?.() !== false;
      if (!visible) {
        continuous.clear();
        return;
      }
      // qualification
      const { pages, viewportArea } = visibilityRef.current;
      const need = optsRef.current.qualifySeconds * 1000;
      for (const idx of [...continuous.keys()]) if (!pages.has(idx)) continuous.delete(idx);
      for (const [idx, v] of pages) {
        const threshold = 0.5 * Math.min(v.area, viewportArea || v.area);
        if (v.visible >= threshold && threshold > 0) {
          const t = (continuous.get(idx) ?? 0) + dt;
          continuous.set(idx, t);
          if (t >= need && !reported.has(idx)) {
            reported.add(idx);
            pendingQualified.add(idx);
          }
        } else continuous.delete(idx);
      }
      // session time
      const active = now - lastInteraction <= optsRef.current.idleSeconds * 1000;
      if (active) {
        activeMs += dt;
        if (!sessionId && !starting) {
          starting = true;
          void ProgressRepository.startSession(bookId).then((id) => {
            sessionId = id;
            starting = false;
          });
        }
      }
      if (now - lastCheckpoint >= 15_000) checkpoint();
    };

    const interval = window.setInterval(tick, 1000);
    flushTimer = window.setInterval(flushQualified, 3000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        flushQualified();
        checkpoint();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(flushTimer);
      for (const ev of events) window.removeEventListener(ev, onInteract);
      window.removeEventListener('scroll', onInteract, { capture: true });
      document.removeEventListener('visibilitychange', onHide);
      flushQualified();
      checkpoint();
    };
  }, [bookId, visibilityRef, opts.enabled]);
}
