import { useEffect, useState } from 'react';
import {
  ArrowLeft, List, LayoutGrid, Search, Bookmark, BookmarkCheck, PenLine, MoreHorizontal, ZoomIn, ZoomOut,
  RotateCw, ChevronLeft, ChevronRight, Highlighter, Eraser, Undo2, Redo2, Check, AlertTriangle, Hand, NotebookPen,
  Columns2, File, ScrollText,
} from 'lucide-react';
import { IconButton, Menu, cx } from '../../components/ui';
import { useReader, type ReaderStore } from './readerStore';
import type { BookInk } from '../ink/useBookInk';
import type { BookRecord } from '../../core/storage/types';

/** Last effective scale published by the reader view (survives toolbar remounts). */
let lastScale = 1;
if (typeof window !== 'undefined') window.addEventListener('folio:scale', (e) => (lastScale = (e as CustomEvent<number>).detail));

export function useEffectiveScale() {
  const [scale, setScale] = useState(() => lastScale);
  useEffect(() => {
    const on = (e: Event) => setScale((e as CustomEvent<number>).detail);
    window.addEventListener('folio:scale', on);
    return () => window.removeEventListener('folio:scale', on);
  }, []);
  return scale;
}

export function TopBar({
  book,
  store,
  onBack,
  bookmarked,
  onToggleBookmark,
  moreItems,
  embedded,
  onStudy,
  readOnly,
}: {
  book: BookRecord;
  store: ReaderStore;
  onBack?: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  moreItems: Parameters<typeof Menu>[0]['items'];
  embedded?: boolean;
  onStudy?: () => void;
  readOnly: boolean;
}) {
  const panel = useReader(store, (s) => s.panel);
  const tool = useReader(store, (s) => s.tool);
  const viewMode = useReader(store, (s) => s.viewMode);
  const zoomMode = useReader(store, (s) => s.zoomMode);
  const scale = useEffectiveScale();
  const set = store.getState().set;
  const toggle = (p: typeof panel) => set({ panel: panel === p ? null : p });
  return (
    <header className="safe-pt z-20 flex flex-wrap items-center gap-1 border-b border-line bg-surface/95 px-2 py-1 backdrop-blur">
      {onBack && (
        <IconButton label="Back to library" onClick={onBack}>
          <ArrowLeft size={20} />
        </IconButton>
      )}
      <h1 className={cx('min-w-0 flex-1 truncate px-1 text-sm font-semibold', embedded && 'sr-only')}>{book.title}</h1>
      {embedded && <span className="flex-1" />}
      <IconButton label="Contents" pressed={panel === 'outline'} onClick={() => toggle('outline')}>
        <List size={20} />
      </IconButton>
      <IconButton label="Page thumbnails" pressed={panel === 'thumbs'} onClick={() => toggle('thumbs')} className="hidden sm:inline-flex">
        <LayoutGrid size={20} />
      </IconButton>
      <IconButton label="Search in book" pressed={panel === 'search'} onClick={() => toggle('search')}>
        <Search size={20} />
      </IconButton>
      <IconButton label={bookmarked ? 'Remove bookmark for this page' : 'Bookmark this page'} pressed={bookmarked} onClick={onToggleBookmark} disabled={readOnly}>
        {bookmarked ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
      </IconButton>
      <div className="hidden items-center md:flex" role="group" aria-label="Zoom">
        <IconButton label="Zoom out" onClick={() => store.getState().zoomBy(1 / 1.2, scale)}>
          <ZoomOut size={20} />
        </IconButton>
        <span className="w-12 text-center text-xs tabular-nums text-muted" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton label="Zoom in" onClick={() => store.getState().zoomBy(1.2, scale)}>
          <ZoomIn size={20} />
        </IconButton>
      </div>
      <IconButton
        label={tool === 'read' ? 'Annotate with pen' : 'Stop annotating'}
        pressed={tool !== 'read'}
        onClick={() => set({ tool: tool === 'read' ? 'draw' : 'read', panel: null })}
        disabled={readOnly}
      >
        <PenLine size={20} />
      </IconButton>
      {onStudy && (
        <IconButton label="Study with notebook" onClick={onStudy}>
          <NotebookPen size={20} />
        </IconButton>
      )}
      <Menu
        label="View and more"
        trigger={<MoreHorizontal size={20} />}
        items={[
          { label: 'Single page', icon: <File size={16} />, onSelect: () => set({ viewMode: 'single' }), disabled: viewMode === 'single' },
          { label: 'Two-page spread', icon: <Columns2 size={16} />, onSelect: () => set({ viewMode: 'spread' }), disabled: viewMode === 'spread' },
          { label: 'Continuous scroll', icon: <ScrollText size={16} />, onSelect: () => set({ viewMode: 'scroll' }), disabled: viewMode === 'scroll' },
          'sep',
          { label: 'Fit width', onSelect: () => set({ zoomMode: 'fitWidth' }), disabled: zoomMode === 'fitWidth' },
          { label: 'Fit page', onSelect: () => set({ zoomMode: 'fitPage' }), disabled: zoomMode === 'fitPage' },
          { label: 'Zoom in', icon: <ZoomIn size={16} />, onSelect: () => store.getState().zoomBy(1.2, scale) },
          { label: 'Zoom out', icon: <ZoomOut size={16} />, onSelect: () => store.getState().zoomBy(1 / 1.2, scale) },
          { label: 'Rotate view', icon: <RotateCw size={16} />, onSelect: () => set({ rotation: (((store.getState().rotation + 90) % 360) as 0 | 90 | 180 | 270) }) },
          { label: 'Pages', icon: <LayoutGrid size={16} />, onSelect: () => toggle('thumbs') },
          { label: 'Bookmarks', icon: <Bookmark size={16} />, onSelect: () => toggle('bookmarks') },
          'sep',
          ...moreItems,
        ]}
      />
    </header>
  );
}

const COLORS = ['#1f3a8a', '#202522', '#b42318', '#2e7d4f', '#7c3aed'];
const HL_COLORS = ['#f2c94c', '#8fd19e', '#7cc3f5', '#f5a3c7'];

export function InkBar({ store, ink, fingerDraws, onFingerDraws }: { store: ReaderStore; ink: BookInk; fingerDraws: boolean; onFingerDraws: (v: boolean) => void }) {
  const tool = useReader(store, (s) => s.tool);
  const activeInk = useReader(store, (s) => s.activeInk);
  const pen = useReader(store, (s) => s.pen);
  const hl = useReader(store, (s) => s.highlighter);
  const set = store.getState().set;
  const style = activeInk === 'pen' ? pen : hl;
  const colors = activeInk === 'pen' ? COLORS : HL_COLORS;
  const widths = activeInk === 'pen' ? [0.8, 1.6, 3] : [8, 12, 18];
  if (tool === 'read') return null;
  const status = ink.status;
  return (
    <div className="z-20 flex flex-wrap items-center gap-1 border-b border-line bg-surface px-2 py-1" role="toolbar" aria-label="Annotation tools">
      <IconButton label="Pen" pressed={tool === 'draw' && activeInk === 'pen'} onClick={() => set({ tool: 'draw', activeInk: 'pen' })}>
        <PenLine size={20} />
      </IconButton>
      <IconButton label="Highlighter" pressed={tool === 'draw' && activeInk === 'highlighter'} onClick={() => set({ tool: 'draw', activeInk: 'highlighter' })}>
        <Highlighter size={20} />
      </IconButton>
      <IconButton label="Eraser (removes whole strokes)" pressed={tool === 'erase'} onClick={() => set({ tool: 'erase' })}>
        <Eraser size={20} />
      </IconButton>
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <div role="radiogroup" aria-label="Colour" className="flex items-center">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={style.color === c}
            aria-label={`Colour ${c}`}
            onClick={() => set(activeInk === 'pen' ? { pen: { ...pen, color: c }, tool: 'draw' } : { highlighter: { ...hl, color: c }, tool: 'draw' })}
            className="inline-flex h-11 w-9 items-center justify-center"
          >
            <span className={cx('h-6 w-6 rounded-full border-2', style.color === c ? 'border-ink' : 'border-transparent')} style={{ background: c }} />
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Thickness" className="flex items-center">
        {widths.map((w, i) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={style.width === w}
            aria-label={['Thin', 'Medium', 'Thick'][i]}
            onClick={() => set(activeInk === 'pen' ? { pen: { ...pen, width: w }, tool: 'draw' } : { highlighter: { ...hl, width: w }, tool: 'draw' })}
            className={cx('inline-flex h-11 w-9 items-center justify-center rounded-lg', style.width === w && 'bg-accent-soft')}
          >
            <span className="rounded-full bg-ink" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
          </button>
        ))}
      </div>
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <IconButton label="Undo" onClick={() => void ink.undo()} disabled={!ink.canUndo}>
        <Undo2 size={20} />
      </IconButton>
      <IconButton label="Redo" onClick={() => void ink.redo()} disabled={!ink.canRedo}>
        <Redo2 size={20} />
      </IconButton>
      <IconButton label={fingerDraws ? 'Finger draws (tap to make finger scroll)' : 'Finger scrolls (tap to make finger draw)'} pressed={fingerDraws} onClick={() => onFingerDraws(!fingerDraws)}>
        <Hand size={20} />
      </IconButton>
      <span className="ml-auto flex items-center gap-1 px-2 text-xs" role="status" aria-live="polite" data-testid="save-status">
        {status.kind === 'saving' && <span className="text-muted">Saving…</span>}
        {status.kind === 'saved' && (
          <span className="flex items-center gap-1 text-accent">
            <Check size={14} aria-hidden /> Saved on this device
          </span>
        )}
        {status.kind === 'error' && (
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle size={14} aria-hidden /> Not saved
            {ink.failed.length > 0 && (
              <button className="min-h-11 px-2 font-semibold underline" onClick={() => void ink.retryFailed()}>
                Retry
              </button>
            )}
          </span>
        )}
      </span>
      <button type="button" onClick={() => set({ tool: 'read' })} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-accent hover:bg-surface-2">
        Done
      </button>
    </div>
  );
}

export function BottomBar({ store }: { store: ReaderStore }) {
  const n = useReader(store, (s) => s.numPages);
  const current = useReader(store, (s) => s.current);
  const labels = useReader(store, (s) => s.labels);
  const noText = useReader(store, (s) => s.noText[s.current]);
  const rtl = useReader(store, (s) => s.direction === 'rtl');
  const strokeActive = useReader(store, (s) => s.strokeActive);
  const [jump, setJump] = useState('');
  const label = labels?.[current]?.trim() || String(current + 1);
  const st = store.getState();
  const prevBtn = (
    <IconButton label="Previous page" onClick={() => st.prev()} disabled={current === 0 || strokeActive}>
      {rtl ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
    </IconButton>
  );
  const nextBtn = (
    <IconButton label="Next page" onClick={() => st.next()} disabled={current >= n - 1 || strokeActive}>
      {rtl ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </IconButton>
  );
  return (
    <footer className="safe-pb z-20 border-t border-line bg-surface/95 px-2 backdrop-blur">
      {noText && (
        <p className="px-2 pt-1 text-center text-xs text-muted" data-testid="no-text-notice">
          This page has no selectable text (it may be a scanned image), so it cannot be searched or selected.
        </p>
      )}
      <div className="flex items-center gap-1 py-1" dir={rtl ? 'rtl' : 'ltr'}>
        {prevBtn}
        <label className="sr-only" htmlFor="page-scrubber">
          Page position
        </label>
        <input
          id="page-scrubber"
          type="range"
          min={1}
          max={Math.max(1, n)}
          value={current + 1}
          onChange={(e) => st.goTo(Number(e.target.value) - 1)}
          aria-valuetext={`Page ${label} of ${n}`}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <form
          dir="ltr"
          className="flex items-center gap-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const v = jump.trim();
            if (!v) return;
            const byLabel = labels?.findIndex((l) => l === v) ?? -1;
            const idx = byLabel >= 0 ? byLabel : Number.parseInt(v, 10) - 1;
            if (Number.isFinite(idx)) st.goTo(idx);
            setJump('');
          }}
        >
          <label htmlFor="page-jump" className="sr-only">
            Go to page
          </label>
          <input
            id="page-jump"
            inputMode="numeric"
            value={jump}
            placeholder={label}
            onChange={(e) => setJump(e.target.value)}
            className="h-11 w-14 rounded-lg border border-line bg-surface text-center tabular-nums"
            aria-describedby="page-of"
          />
          <span id="page-of" className="whitespace-nowrap text-xs text-muted" data-testid="page-indicator">
            {labels && label !== String(current + 1) ? `${label} · ` : ''}
            {current + 1} / {n}
          </span>
        </form>
        {nextBtn}
      </div>
    </footer>
  );
}
