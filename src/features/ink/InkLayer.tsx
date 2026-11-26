import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  clientToElement,
  normalisePressure,
  paintOutline,
  strokeHit,
  strokeOutline,
  type SpaceTransform,
} from '../../core/ink/geometry';
import type { InkStyle, StrokePoint } from '../../core/storage/types';

export interface DrawableStroke {
  id: string;
  points: StrokePoint[];
  outline: [number, number][];
  style: InkStyle;
}

export interface InkLayerProps {
  width: number; // CSS px
  height: number;
  transform: SpaceTransform;
  strokes: DrawableStroke[];
  mode: 'read' | 'draw' | 'erase';
  style: InkStyle;
  fingerDraws: boolean;
  onCommit: (points: StrokePoint[], style: InkStyle) => void;
  onErase: (ids: string[]) => void;
  onStrokeActive: (active: boolean) => void;
  onCheckpoint?: (points: StrokePoint[], style: InkStyle) => void;
  /** Called with finger pan deltas when a finger should navigate in draw mode. */
  onPan?: (dx: number, dy: number) => void;
  label: string;
}

const ERASER_CSS_RADIUS = 10;

/**
 * Pointer-event ink overlay (spec 5, 12.3). Coordinates are converted to canonical
 * space through the page transform; screen pixels are never stored. One pointer owns
 * a stroke; other contacts are ignored until it ends. Cancel / lost capture discards
 * the in-progress stroke (no ghost strokes). Completed strokes are handed to onCommit.
 */
export function InkLayer(p: InkLayerProps) {
  const committed = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const owner = useRef<number | null>(null);
  const points = useRef<StrokePoint[]>([]);
  const erasing = useRef<Set<string>>(new Set());
  const raf = useRef(0);
  const lastCheckpoint = useRef(0);
  const panFinger = useRef<{ id: number; x: number; y: number } | null>(null);
  const touches = useRef(new Set<number>());
  const props = useRef(p);
  props.current = p;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  const setup = (c: HTMLCanvasElement | null) => {
    if (!c) return null;
    const w = Math.max(1, Math.round(p.width * dpr));
    const h = Math.max(1, Math.round(p.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  const repaintCommitted = () => {
    const ctx = setup(committed.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, p.width, p.height);
    for (const s of props.current.strokes) {
      if (erasing.current.has(s.id)) continue;
      paintOutline(ctx, s.outline, props.current.transform, s.style);
    }
  };

  useLayoutEffect(repaintCommitted);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const paintLive = () => {
    raf.current = 0;
    const ctx = setup(live.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, p.width, p.height);
    if (points.current.length) paintOutline(ctx, strokeOutline(points.current, props.current.style), props.current.transform, props.current.style);
  };
  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(paintLive);
  };

  const toCanonical = (e: { clientX: number; clientY: number }) => {
    const rect = live.current!.getBoundingClientRect();
    const [x, y] = clientToElement(e.clientX, e.clientY, rect, props.current.width, props.current.height);
    return props.current.transform.toCanonical(x, y);
  };

  const endStroke = (commit: boolean) => {
    const pts = points.current;
    points.current = [];
    owner.current = null;
    props.current.onStrokeActive(false);
    schedule();
    if (commit && pts.length) props.current.onCommit(pts, props.current.style);
  };

  const eraseAt = (e: { clientX: number; clientY: number }) => {
    const [x, y] = toCanonical(e);
    const r = ERASER_CSS_RADIUS / props.current.transform.scale;
    let changed = false;
    for (const s of props.current.strokes) {
      if (erasing.current.has(s.id)) continue;
      if (strokeHit(s.points, s.style.width, x, y, r)) {
        erasing.current.add(s.id);
        changed = true;
      }
    }
    if (changed) repaintCommitted();
  };

  const allowed = (e: React.PointerEvent) => {
    if (props.current.mode === 'read') return false;
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse') return e.button === 0;
    return props.current.fingerDraws;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') touches.current.add(e.pointerId);
    if (owner.current !== null) return; // palm / second contact during a stroke
    if (!allowed(e)) {
      if (e.pointerType === 'touch' && props.current.mode !== 'read' && touches.current.size === 1) {
        panFinger.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    owner.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    props.current.onStrokeActive(true);
    lastCheckpoint.current = performance.now();
    if (props.current.mode === 'erase') {
      erasing.current = new Set();
      eraseAt(e);
      return;
    }
    const [x, y] = toCanonical(e);
    points.current = [{ x, y, p: normalisePressure(e.pointerType, e.pressure) }];
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panFinger.current;
    if (pan && pan.id === e.pointerId) {
      if (touches.current.size > 1) {
        panFinger.current = null;
        return;
      }
      props.current.onPan?.(e.clientX - pan.x, e.clientY - pan.y);
      pan.x = e.clientX;
      pan.y = e.clientY;
      return;
    }
    if (owner.current !== e.pointerId) return;
    e.preventDefault();
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length ? events : [e.nativeEvent];
    if (props.current.mode === 'erase') {
      for (const ev of list) eraseAt(ev);
      return;
    }
    for (const ev of list) {
      const [x, y] = toCanonical(ev);
      points.current.push({ x, y, p: normalisePressure(ev.pointerType, ev.pressure) });
    }
    schedule();
    const now = performance.now();
    if (props.current.onCheckpoint && now - lastCheckpoint.current > 1000 && points.current.length > 20) {
      lastCheckpoint.current = now;
      props.current.onCheckpoint(points.current.slice(), props.current.style);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
    if (panFinger.current?.id === e.pointerId) panFinger.current = null;
    if (owner.current !== e.pointerId) return;
    if (props.current.mode === 'erase') {
      const ids = [...erasing.current];
      owner.current = null;
      props.current.onStrokeActive(false);
      if (ids.length) props.current.onErase(ids);
      erasing.current = new Set();
      return;
    }
    endStroke(true);
  };

  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
    if (panFinger.current?.id === e.pointerId) panFinger.current = null;
    if (owner.current !== e.pointerId) return;
    if (props.current.mode === 'erase') {
      erasing.current = new Set();
      owner.current = null;
      props.current.onStrokeActive(false);
      repaintCommitted();
      return;
    }
    endStroke(false);
  };

  const style = { width: p.width, height: p.height };
  return (
    <>
      <canvas ref={committed} className="pointer-events-none absolute inset-0 z-[2]" style={style} aria-hidden />
      <canvas
        ref={live}
        className="ink-layer"
        style={style}
        role={p.mode === 'read' ? undefined : 'img'}
        aria-label={p.mode === 'read' ? undefined : p.label}
        aria-hidden={p.mode === 'read' ? true : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={(e) => {
          if (owner.current === e.pointerId) onCancel(e);
        }}
        onContextMenu={(e) => p.mode !== 'read' && e.preventDefault()}
      />
    </>
  );
}
