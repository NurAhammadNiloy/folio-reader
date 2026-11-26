import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { TextLayer } from 'pdfjs-dist';
import {
  cssViewport,
  isRenderCancelled,
  renderPage,
  type PageDescriptor,
  type PDFDocumentProxy,
  type PageViewport,
} from '../../core/documents/pdfEngine';
import { pdfTransform } from '../../core/ink/geometry';
import type { RenderBudget } from './renderBudget';
import { InkLayer } from '../ink/InkLayer';
import type { AnnotationRecord, InkStyle, StrokePoint } from '../../core/storage/types';
import type { Tool } from './readerStore';
import { getPageText } from './textCache';

export interface PageViewProps {
  doc: PDFDocumentProxy;
  index: number;
  desc: PageDescriptor | null;
  fallback: { width: number; height: number };
  scale: number;
  extraRotation: number;
  render: boolean;
  visible: boolean;
  budget: RenderBudget;
  label: string;
  tool: Tool;
  inkStyle: InkStyle;
  strokes: AnnotationRecord[] | undefined;
  fingerDraws: boolean;
  search: { query: string; activeStart: number | null };
  onNoText: (index: number, noText: boolean) => void;
  onCommit: (index: number, points: StrokePoint[], style: InkStyle, unitsPerCssPx: number) => void;
  onErase: (ids: string[]) => void;
  onStrokeActive: (active: boolean) => void;
  onCheckpoint: (index: number, points: StrokePoint[], style: InkStyle) => void;
  onPan: (dx: number, dy: number) => void;
  className?: string;
}

export function pageCssSize(desc: PageDescriptor | null, fallback: { width: number; height: number }, scale: number, extraRotation: number) {
  const w = (desc?.width ?? fallback.width) * scale;
  const h = (desc?.height ?? fallback.height) * scale;
  return extraRotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export const PageView = memo(function PageView(p: PageViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const size = pageCssSize(p.desc, p.fallback, p.scale, p.extraRotation);
  const { budget, index } = p;

  // Render canvas + text layer for this page while it is in the active window.
  useEffect(() => {
    if (!p.render) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    let textLayer: TextLayer | null = null;
    (async () => {
      const page = await p.doc.getPage(index + 1);
      if (cancelled) return;
      const vp = cssViewport(page, p.scale, p.extraRotation);
      setViewport(vp);
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.className = 'page-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const ratio = budget.reserve(index, vp.width, vp.height, dpr, p.visible, () => {
        if (canvasRef.current === canvas) {
          canvas.remove();
          canvas.width = canvas.height = 0;
          canvasRef.current = null;
          setRendered(false);
        }
      });
      const task = renderPage(page, vp, canvas, ratio);
      cancelRender = task.cancel;
      try {
        await task.promise;
      } catch (err) {
        budget.release(index);
        if (!isRenderCancelled(err) && !cancelled) setFailed(true);
        return;
      }
      if (cancelled) {
        budget.release(index);
        return;
      }
      const old = canvasRef.current;
      host.current?.prepend(canvas);
      if (old && old !== canvas) {
        old.remove();
        old.width = old.height = 0;
      }
      canvasRef.current = canvas;
      setRendered(true);
      setFailed(false);
      // Text layer: selectable/searchable embedded text, built with safe DOM APIs.
      const text = await getPageText(p.doc, index);
      if (cancelled || !textHost.current) return;
      const hasText = text.items.some((it) => 'str' in it && it.str.trim().length > 0);
      p.onNoText(index, !hasText);
      const container = textHost.current;
      container.replaceChildren();
      container.style.setProperty('--total-scale-factor', String(vp.scale * (vp.userUnit ?? 1)));
      textLayer = new TextLayer({ textContentSource: text.content, container, viewport: vp });
      await textLayer.render().catch(() => undefined);
      if (!cancelled) setTextReady((n) => n + 1);
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      cancelRender?.();
      textLayer?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.render, p.scale, p.extraRotation, p.doc, index, budget]);

  useEffect(() => {
    budget.setVisible(index, p.visible);
  }, [budget, index, p.visible]);

  useEffect(
    () => () => {
      budget.release(index);
      const c = canvasRef.current;
      if (c) {
        c.remove();
        c.width = c.height = 0;
      }
    },
    [budget, index],
  );

  // Search highlights inside the text layer spans.
  useEffect(() => {
    const container = textHost.current;
    if (!container) return;
    highlight(container, p.search.query, p.search.activeStart);
  }, [p.search.query, p.search.activeStart, textReady]);

  const transform = useMemo(() => (viewport ? pdfTransform(viewport) : null), [viewport]);
  const modeClass = p.tool === 'read' ? 'mode-read' : p.tool === 'draw' ? 'mode-draw' : 'mode-erase';
  const strokes = p.strokes ?? [];

  return (
    <div
      ref={host}
      className={`folio-page ${modeClass} ${p.className ?? ''}`}
      style={{ width: size.width, height: size.height }}
      data-page-index={index}
      role="region"
      aria-label={`Page ${p.label}`}
    >
      {!rendered && !failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-neutral-400" aria-hidden>
          {p.label}
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-white p-4 text-center text-sm text-neutral-600" role="alert">
          This page could not be displayed.
        </div>
      )}
      <div ref={textHost} className="textLayer" />
      {transform && viewport && Math.abs(viewport.width - size.width) < 1 && (
        <InkLayer
          width={size.width}
          height={size.height}
          transform={transform}
          strokes={strokes}
          mode={p.tool}
          style={p.inkStyle}
          fingerDraws={p.fingerDraws}
          label={`Drawing surface for page ${p.label}`}
          onCommit={(pts, st) => p.onCommit(index, pts, st, 1 / transform.scale)}
          onErase={p.onErase}
          onStrokeActive={p.onStrokeActive}
          onCheckpoint={(pts, st) => p.onCheckpoint(index, pts, st)}
          onPan={p.onPan}
        />
      )}
    </div>
  );
});

function highlight(container: HTMLElement, query: string, activeStart: number | null) {
  // Undo previous highlights
  for (const m of [...container.querySelectorAll('mark.folio-hit')]) {
    const parent = m.parentNode!;
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
    parent.normalize();
  }
  const q = query.trim().toLocaleLowerCase();
  if (!q) return;
  const spans = [...container.querySelectorAll<HTMLSpanElement>(':scope span:not(.markedContent):not(.endOfContent)')].filter(
    (s) => s.childElementCount === 0,
  );
  // Build the same concatenation used by the search index (items joined by EOL-aware spacing).
  let text = '';
  const ranges: { span: HTMLSpanElement; start: number; end: number }[] = [];
  for (const s of spans) {
    const t = s.textContent ?? '';
    if (!t.length) continue;
    ranges.push({ span: s, start: text.length, end: text.length + t.length });
    text += t + ' ';
  }
  const lower = text.toLocaleLowerCase();
  let from = 0;
  let first: HTMLElement | null = null;
  const hits: { start: number; end: number }[] = [];
  while (true) {
    const at = lower.indexOf(q, from);
    if (at < 0) break;
    hits.push({ start: at, end: at + q.length });
    from = at + q.length;
  }
  for (const r of ranges) {
    const local = hits.filter((h) => h.start < r.end && h.end > r.start);
    if (!local.length) continue;
    const t = r.span.textContent ?? '';
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const h of local) {
      const s = Math.max(0, h.start - r.start);
      const e = Math.min(t.length, h.end - r.start);
      if (s > pos) frag.append(t.slice(pos, s));
      const mark = document.createElement('mark');
      mark.className = 'folio-hit';
      if (activeStart !== null && h.start === activeStart) {
        mark.classList.add('active');
        first ??= mark;
      }
      mark.textContent = t.slice(s, e);
      frag.append(mark);
      pos = e;
    }
    if (pos < t.length) frag.append(t.slice(pos));
    r.span.replaceChildren(frag);
  }
  first?.scrollIntoView({ block: 'center', inline: 'nearest' });
}
