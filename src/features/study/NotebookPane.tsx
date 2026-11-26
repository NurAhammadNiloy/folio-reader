import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  PenLine, Highlighter, Eraser, Type, Undo2, Redo2, Plus, Trash2, ArrowUp, ArrowDown, Link2, Link2Off, Download, ZoomIn, ZoomOut, X, MousePointer2,
} from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { NotebookRepository } from '../../core/storage/notebookRepository';
import { notebookTransform, simplify, strokeOutline } from '../../core/ink/geometry';
import { InkHistory } from '../../core/ink/history';
import { newId } from '../../core/storage/ids';
import { InkLayer } from '../ink/InkLayer';
import { Button, IconButton, Menu, cx, download, safeFileName } from '../../components/ui';
import { errorMessage, useApp } from '../../app/appStore';
import type { InkStyle, NotebookPageRecord, NotebookRecord, NotebookStroke, NotebookTemplate, StrokePoint, TextBlock } from '../../core/storage/types';
import type { SaveStatus } from '../ink/useBookInk';
import { activePane, setActivePane } from './activePane';

type NbTool = 'select' | 'draw' | 'erase' | 'text';
type Item = { pageId: string; stroke: NotebookStroke };

const PEN: InkStyle = { tool: 'pen', color: '#202522', width: 1.6, opacity: 1 };
const HL: InkStyle = { tool: 'highlighter', color: '#f2c94c', width: 12, opacity: 0.35 };

export function NotebookPane({
  notebook,
  currentBookPage,
  currentBookLabel,
  onJump,
  bookTitles,
}: {
  notebook: NotebookRecord;
  currentBookPage: number | null;
  currentBookLabel?: string;
  onJump?: (bookId: string, pageIndex: number) => void;
  bookTitles: Map<string, string>;
}) {
  const toast = useApp((s) => s.toast);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const fingerDraws = useApp((s) => s.settings.fingerInDrawMode === 'draw');
  const pages = useLiveQuery(() => NotebookRepository.pages(notebook.id), [notebook.id]);
  const [tool, setTool] = useState<NbTool>('draw');
  const [ink, setInk] = useState<'pen' | 'highlighter'>('pen');
  const [pen, setPen] = useState(PEN);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit width
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [local, setLocal] = useState<Map<string, NotebookPageRecord>>(new Map());
  const [, force] = useState(0);
  const history = useRef(new InkHistory<Item>());
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => history.current.reset(), [notebook.id]);
  // Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z undo and redo in the notebook while it is the pane in use.
  const keyActions = useRef({ undo: () => {}, redo: () => {} });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activePane() !== 'notebook' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"], dialog[open]')) return; // native text undo
      e.preventDefault();
      if (e.shiftKey) keyActions.current.redo();
      else keyActions.current.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setActivePane('book');
    };
  }, []);

  // Local optimistic copies until the DB reflects them.
  const view = useMemo(() => (pages ?? []).map((p) => {
    const l = local.get(p.id);
    return l && l.updatedAt >= p.updatedAt ? l : p;
  }), [pages, local]);

  const fitScale = Math.max(0.3, (width - 32) / 595);
  const scale = zoom ?? fitScale;

  async function save(page: NotebookPageRecord) {
    const next = { ...page, updatedAt: Date.now() };
    setLocal((m) => new Map(m).set(page.id, next));
    setStatus({ kind: 'saving' });
    try {
      await NotebookRepository.savePage(next);
      setStatus({ kind: 'saved' });
      return true;
    } catch (e) {
      setStatus({ kind: 'error', message: errorMessage(e) });
      return false;
    }
  }

  const style = ink === 'pen' ? pen : HL;

  async function commit(page: NotebookPageRecord, points: StrokePoint[], st: InkStyle) {
    const simplified = simplify(points, 0.35 / scale);
    const stroke: NotebookStroke = { id: newId(), points: simplified, outline: strokeOutline(simplified, st), style: { ...st }, createdAt: Date.now() };
    if (await save({ ...page, strokes: [...page.strokes, stroke] })) history.current.push({ kind: 'add', strokes: [{ pageId: page.id, stroke }] });
    force((n) => n + 1);
  }
  async function erase(page: NotebookPageRecord, ids: string[]) {
    const set = new Set(ids);
    const removed = page.strokes.filter((s) => set.has(s.id));
    if (await save({ ...page, strokes: page.strokes.filter((s) => !set.has(s.id)) })) history.current.push({ kind: 'remove', strokes: removed.map((stroke) => ({ pageId: page.id, stroke })) });
    force((n) => n + 1);
  }
  async function applyOp(op: { kind: 'add' | 'remove'; strokes: Item[] }) {
    const pageId = op.strokes[0]?.pageId;
    const page = view.find((p) => p.id === pageId);
    if (!page) return false;
    const list = op.strokes.map((i) => i.stroke);
    const ids = new Set(list.map((s) => s.id));
    const strokes = op.kind === 'add' ? [...page.strokes.filter((s) => !ids.has(s.id)), ...list] : page.strokes.filter((s) => !ids.has(s.id));
    return save({ ...page, strokes });
  }
  async function undo() {
    const op = history.current.peekUndo();
    if (op && (await applyOp(op))) history.current.commitUndo();
    force((n) => n + 1);
  }
  async function redo() {
    const op = history.current.peekRedo();
    if (op && (await applyOp(op))) history.current.commitRedo();
    force((n) => n + 1);
  }

  const fail = (e: unknown) => toast({ kind: 'error', message: errorMessage(e) });

  async function exportPdf() {
    try {
      const { exportNotebookPdf } = await import('../../core/export/notebookPdf');
      const bytes = await exportNotebookPdf(notebook.title, view);
      download(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), `${safeFileName(notebook.title)}.pdf`);
      toast({ kind: 'success', message: 'Notebook exported. Pages are saved as images, so text is not selectable in the PDF.' });
    } catch (e) {
      fail(e);
    }
  }

  keyActions.current = { undo: () => void undo(), redo: () => void redo() };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-surface-2"
      data-testid="notebook"
      onPointerDownCapture={() => setActivePane('notebook')}
      onFocusCapture={() => setActivePane('notebook')}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-2 py-1" role="toolbar" aria-label="Notebook tools">
        <IconButton label="Select and scroll" pressed={tool === 'select'} onClick={() => setTool('select')}>
          <MousePointer2 size={18} />
        </IconButton>
        <IconButton label="Pen" pressed={tool === 'draw' && ink === 'pen'} onClick={() => { setTool('draw'); setInk('pen'); }} disabled={readOnly}>
          <PenLine size={18} />
        </IconButton>
        <IconButton label="Highlighter" pressed={tool === 'draw' && ink === 'highlighter'} onClick={() => { setTool('draw'); setInk('highlighter'); }} disabled={readOnly}>
          <Highlighter size={18} />
        </IconButton>
        <IconButton label="Eraser" pressed={tool === 'erase'} onClick={() => setTool('erase')} disabled={readOnly}>
          <Eraser size={18} />
        </IconButton>
        <IconButton label="Add text (tap the page)" pressed={tool === 'text'} onClick={() => setTool('text')} disabled={readOnly}>
          <Type size={18} />
        </IconButton>
        {['#202522', '#1f3a8a', '#b42318'].map((c) => (
          <button key={c} type="button" aria-label={`Pen colour ${c}`} aria-pressed={pen.color === c} onClick={() => { setPen({ ...pen, color: c }); setTool('draw'); setInk('pen'); }} className="inline-flex h-11 w-8 items-center justify-center">
            <span className={cx('h-5 w-5 rounded-full border-2', pen.color === c ? 'border-ink' : 'border-transparent')} style={{ background: c }} />
          </button>
        ))}
        <IconButton label="Undo" onClick={() => void undo()} disabled={!history.current.canUndo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton label="Redo" onClick={() => void redo()} disabled={!history.current.canRedo}>
          <Redo2 size={18} />
        </IconButton>
        <IconButton label="Notebook zoom out" onClick={() => setZoom(Math.max(0.3, scale / 1.2))}>
          <ZoomOut size={18} />
        </IconButton>
        <IconButton label="Notebook zoom in" onClick={() => setZoom(Math.min(4, scale * 1.2))}>
          <ZoomIn size={18} />
        </IconButton>
        <span className="ml-auto px-1 text-xs" role="status" aria-live="polite" data-testid="nb-save-status">
          {status.kind === 'saving' && 'Saving…'}
          {status.kind === 'saved' && <span className="text-accent">Saved on this device</span>}
          {status.kind === 'error' && <span className="text-danger">Not saved: {status.message}</span>}
        </span>
        <IconButton label="Export notebook as PDF" onClick={() => void exportPdf()}>
          <Download size={18} />
        </IconButton>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto" style={{ touchAction: tool === 'select' ? 'auto' : 'pan-x pan-y' }}>
        <div className="flex flex-col items-center gap-4 p-4" style={{ minWidth: 'fit-content' }}>
          {pages === undefined && <p className="text-sm text-muted">Loading notebook…</p>}
          {view.map((page, i) => (
            <NotebookPageView
              key={page.id}
              page={page}
              index={i}
              total={view.length}
              scale={scale}
              tool={readOnly ? 'select' : tool}
              style={style}
              fingerDraws={fingerDraws}
              onCommit={(pts, st) => void commit(page, pts, st)}
              onErase={(ids) => void erase(page, ids)}
              onSave={(p) => void save(p)}
              onPan={(dx, dy) => scroller.current?.scrollBy(-dx, -dy)}
              currentBookPage={currentBookPage}
              currentBookLabel={currentBookLabel}
              linkedBookId={notebook.linkedBookId}
              bookTitles={bookTitles}
              onJump={onJump}
              onAddAfter={() => NotebookRepository.addPage(notebook.id, page.order, notebook.template).catch(fail)}
              onDelete={() => NotebookRepository.deletePage(page.id).catch(fail)}
              onMove={(d) => NotebookRepository.movePage(page.id, d).catch(fail)}
              onAddText={(x, y) => {
                const block: TextBlock = { id: newId(), x, y, width: Math.min(400, page.width - x - 20), text: '', fontSize: 14 };
                void save({ ...page, textBlocks: [...page.textBlocks, block] });
                setTool('select');
              }}
              readOnly={readOnly}
            />
          ))}
          {pages && (
            <Button icon={<Plus size={16} />} onClick={() => NotebookRepository.addPage(notebook.id, null, notebook.template).catch(fail)} disabled={readOnly}>
              Add page
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function NotebookPageView(p: {
  page: NotebookPageRecord;
  index: number;
  total: number;
  scale: number;
  tool: NbTool;
  style: InkStyle;
  fingerDraws: boolean;
  onCommit: (pts: StrokePoint[], st: InkStyle) => void;
  onErase: (ids: string[]) => void;
  onSave: (p: NotebookPageRecord) => void;
  onPan: (dx: number, dy: number) => void;
  currentBookPage: number | null;
  currentBookLabel?: string;
  linkedBookId: string | null;
  bookTitles: Map<string, string>;
  onJump?: (bookId: string, pageIndex: number) => void;
  onAddAfter: () => void;
  onDelete: () => void;
  onMove: (d: -1 | 1) => void;
  onAddText: (x: number, y: number) => void;
  readOnly: boolean;
}) {
  const { page, scale } = p;
  const t = useMemo(() => notebookTransform(scale), [scale]);
  const w = page.width * scale;
  const h = page.height * scale;
  const link = page.link;
  const linkTitle = link ? p.bookTitles.get(link.bookId) : undefined;
  const formats = useBookFormats();
  const unit = link && formats.get(link.bookId) === 'epub' ? 'section' : 'page';
  const inkMode = p.tool === 'draw' ? 'draw' : p.tool === 'erase' ? 'erase' : 'read';
  return (
    <section aria-label={`Notebook page ${p.index + 1}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted" style={{ maxWidth: Math.max(w, 300) }}>
        <span className="px-1 font-medium">Page {p.index + 1}</span>
        {link ? (
          linkTitle ? (
            <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-accent hover:bg-surface" onClick={() => p.onJump?.(link.bookId, link.pageIndex)}>
              <Link2 size={14} aria-hidden /> {linkTitle}, {unit} {link.pageIndex + 1}
            </button>
          ) : (
            <span className="inline-flex min-h-11 items-center gap-1 px-2 text-danger">
              <Link2Off size={14} aria-hidden /> Linked book page is missing
            </span>
          )
        ) : null}
        <span className="flex-1" />
        {p.linkedBookId && p.currentBookPage !== null && !p.readOnly && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 hover:bg-surface"
            onClick={() => p.onSave({ ...page, link: { bookId: p.linkedBookId!, pageIndex: p.currentBookPage! } })}
          >
            <Link2 size={14} aria-hidden /> Link to book {p.linkedBookId && formats.get(p.linkedBookId) === 'epub' ? 'section' : 'page'} {p.currentBookPage + 1}
            {p.currentBookLabel && p.currentBookLabel !== String(p.currentBookPage + 1) && <span className="text-muted">(printed {p.currentBookLabel})</span>}
          </button>
        )}
        {link && !p.readOnly && (
          <IconButton label="Remove link" onClick={() => p.onSave({ ...page, link: null })}>
            <X size={14} />
          </IconButton>
        )}
        <Menu
          label={`Page ${p.index + 1} options`}
          trigger={<span className="text-lg leading-none">⋯</span>}
          items={[
            { label: 'Add page after', icon: <Plus size={14} />, onSelect: p.onAddAfter, disabled: p.readOnly },
            { label: 'Move up', icon: <ArrowUp size={14} />, onSelect: () => p.onMove(-1), disabled: p.index === 0 || p.readOnly },
            { label: 'Move down', icon: <ArrowDown size={14} />, onSelect: () => p.onMove(1), disabled: p.index === p.total - 1 || p.readOnly },
            'sep',
            ...(['blank', 'ruled', 'grid', 'dotted'] as NotebookTemplate[]).map((tpl) => ({
              label: `Paper: ${tpl}`,
              onSelect: () => p.onSave({ ...page, template: tpl }),
              disabled: page.template === tpl || p.readOnly,
            })),
            'sep',
            { label: 'Delete page', icon: <Trash2 size={14} />, danger: true, onSelect: p.onDelete, disabled: p.total <= 1 || p.readOnly },
          ]}
        />
      </div>
      <div
        className={cx('relative bg-white shadow-[var(--shadow-book)]', `nb-${page.template}`)}
        style={{ width: w, height: h, ['--u' as string]: `${scale}px` }}
        onClick={(e) => {
          if (p.tool !== 'text') return;
          const r = e.currentTarget.getBoundingClientRect();
          p.onAddText((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        }}
      >
        <div className={cx('folio-page !absolute inset-0 !bg-transparent !shadow-none', inkMode === 'read' ? 'mode-read' : `mode-${inkMode}`)} style={{ width: w, height: h }}>
          <InkLayer
            width={w}
            height={h}
            transform={t}
            strokes={page.strokes}
            mode={inkMode}
            style={p.style}
            fingerDraws={p.fingerDraws}
            label={`Notebook page ${p.index + 1} drawing surface`}
            onCommit={p.onCommit}
            onErase={p.onErase}
            onStrokeActive={() => undefined}
            onPan={p.onPan}
          />
        </div>
        {page.textBlocks.map((b) => (
          <TextBlockEditor key={b.id} block={b} scale={scale} readOnly={p.readOnly} interactive={p.tool === 'select' || p.tool === 'text'}
            onChange={(nb) => p.onSave({ ...page, textBlocks: page.textBlocks.map((x) => (x.id === b.id ? nb : x)) })}
            onDelete={() => p.onSave({ ...page, textBlocks: page.textBlocks.filter((x) => x.id !== b.id) })}
          />
        ))}
      </div>
    </section>
  );
}

function TextBlockEditor({ block, scale, onChange, onDelete, readOnly, interactive }: { block: TextBlock; scale: number; onChange: (b: TextBlock) => void; onDelete: () => void; readOnly: boolean; interactive: boolean }) {
  const [text, setText] = useState(block.text);
  const timer = useRef(0);
  useEffect(() => setText(block.text), [block.text]);
  const lines = Math.max(2, text.split('\n').length + Math.floor(text.length / 50));
  return (
    <div className="group absolute z-[3]" style={{ left: block.x * scale, top: block.y * scale, width: block.width * scale, pointerEvents: interactive ? 'auto' : 'none' }} onClick={(e) => e.stopPropagation()}>
      <label className="sr-only" htmlFor={`tb-${block.id}`}>
        Note text
      </label>
      <textarea
        id={`tb-${block.id}`}
        value={text}
        readOnly={readOnly}
        autoFocus={!block.text}
        dir="auto"
        onChange={(e) => {
          setText(e.target.value);
          window.clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = window.setTimeout(() => onChange({ ...block, text: v }), 500);
        }}
        onBlur={() => {
          window.clearTimeout(timer.current);
          if (text !== block.text) onChange({ ...block, text });
        }}
        rows={lines}
        placeholder="Type a note"
        className="w-full resize-none rounded border border-transparent bg-transparent p-0 text-[#202522] outline-none focus:border-accent focus:bg-white/80"
        style={{ fontSize: block.fontSize * scale, lineHeight: 1.35 }}
      />
      {!readOnly && (
        <button type="button" aria-label="Delete text note" onClick={onDelete} className="absolute -right-2 -top-2 hidden h-8 w-8 items-center justify-center rounded-full bg-surface text-danger shadow group-focus-within:flex group-hover:flex">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function useBookFormats() {
  const books = useLiveQuery(() => getDb().books.toArray(), []);
  return useMemo(() => new Map((books ?? []).map((b) => [b.id, b.format])), [books]);
}

export function useBookTitles() {
  const books = useLiveQuery(() => getDb().books.toArray(), []);
  return useMemo(() => new Map((books ?? []).map((b) => [b.id, b.title])), [books]);
}
