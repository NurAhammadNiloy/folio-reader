import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, ChevronDown, Search, X, ChevronUp, Trash2, Pencil, BookmarkPlus } from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { BookmarkRepository } from '../../core/storage/bookmarkRepository';
import { IconButton, Button, cx } from '../../components/ui';
import { errorMessage, useApp } from '../../app/appStore';
import { readOutline, renderPage, type OutlineNode, type PDFDocumentProxy } from '../../core/documents/pdfEngine';
import { useReader, type ReaderStore, type SearchHit } from './readerStore';
import { getPageText } from './textCache';
import { findAll, foldQuery } from './textMatch';

/** Snippet bounds about 40 characters either side of a hit, widened to whole words. */
function snippetStart(t: string, at: number): number {
  let s = Math.max(0, at - 40);
  while (s > 0 && s > at - 60 && !/\s/.test(t[s - 1]!)) s--;
  return s;
}
function snippetEnd(t: string, end: number): number {
  let e = Math.min(t.length, end + 50);
  while (e < t.length && e < end + 70 && !/\s/.test(t[e]!)) e++;
  return e;
}
import { LIMITS } from '../../core/security/limits';

export function PanelFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside
      aria-label={title}
      className="absolute inset-y-0 left-0 z-30 flex w-[min(340px,100%)] flex-col border-r border-line bg-surface shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

// ---------------- Outline ----------------
export function OutlinePanel({ doc, store, onClose }: { doc: PDFDocumentProxy; store: ReaderStore; onClose: () => void }) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    void readOutline(doc).then(setOutline);
  }, [doc]);
  return (
    <PanelFrame title="Contents" onClose={onClose}>
      {outline === null && <p className="p-4 text-sm text-muted">Loading…</p>}
      {outline?.length === 0 && <p className="p-4 text-sm text-muted">This PDF has no table of contents.</p>}
      {outline && outline.length > 0 && (
        <ul className="p-2" role="tree">
          {outline.map((n, i) => (
            <OutlineItem key={i} node={n} store={store} depth={0} />
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

function OutlineItem({ node, store, depth }: { node: OutlineNode; store: ReaderStore; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const label = useReader(store, (s) => (node.pageIndex !== null ? s.label(node.pageIndex) : ''));
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined}>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {node.children.length > 0 ? (
          <IconButton label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} className="h-9 min-w-9">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </IconButton>
        ) : (
          <span className="w-9" />
        )}
        <button
          type="button"
          disabled={node.pageIndex === null}
          onClick={() => node.pageIndex !== null && store.getState().goTo(node.pageIndex)}
          className="flex min-h-11 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          <span className="flex-1">{node.title}</span>
          <span className="text-xs text-muted">{label}</span>
        </button>
      </div>
      {open && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((c, i) => (
            <OutlineItem key={i} node={c} store={store} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------- Thumbnails ----------------
const thumbCache = new Map<string, string>();
const THUMB_MAX = 80;

function Thumb({ doc, index, docKey, active, label, onClick }: { doc: PDFDocumentProxy; index: number; docKey: string; active: boolean; label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const key = `${docKey}:${index}`;
  const [url, setUrl] = useState<string | null>(thumbCache.get(key) ?? null);
  useEffect(() => {
    if (url) return;
    const el = ref.current!;
    let cancelled = false;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: LIMITS.thumbnailCssWidth / base.width });
      const canvas = document.createElement('canvas');
      try {
        await renderPage(page, vp, canvas, Math.min(2, window.devicePixelRatio || 1)).promise;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.7));
        canvas.width = canvas.height = 0;
        if (!blob || cancelled) return;
        const u = URL.createObjectURL(blob);
        thumbCache.set(key, u);
        if (thumbCache.size > THUMB_MAX) {
          const [oldKey, oldUrl] = thumbCache.entries().next().value as [string, string];
          thumbCache.delete(oldKey);
          URL.revokeObjectURL(oldUrl);
        }
        setUrl(u);
      } catch {
        /* thumbnails are disposable */
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, index, key, url]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={`Go to page ${label}`}
      className={cx('flex flex-col items-center gap-1 rounded-lg p-2 hover:bg-surface-2', active && 'bg-accent-soft')}
    >
      <span className={cx('block w-[120px] bg-white shadow-[var(--shadow-soft)]', active && 'ring-2 ring-accent')} style={{ minHeight: 60 }}>
        {url ? <img src={url} alt="" className="block w-full" /> : <span className="block aspect-[3/4] w-full" />}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </button>
  );
}

export function ThumbsPanel({ doc, store, docKey, onClose }: { doc: PDFDocumentProxy; store: ReaderStore; docKey: string; onClose: () => void }) {
  const n = useReader(store, (s) => s.numPages);
  const current = useReader(store, (s) => s.current);
  const labels = useReader(store, (s) => s.labels);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <PanelFrame title="Pages" onClose={onClose}>
      <div ref={list} className="grid grid-cols-2 gap-1 p-2">
        {Array.from({ length: n }, (_, i) => (
          <Thumb key={i} doc={doc} index={i} docKey={docKey} active={i === current} label={labels?.[i]?.trim() || String(i + 1)} onClick={() => store.getState().goTo(i)} />
        ))}
      </div>
    </PanelFrame>
  );
}

// ---------------- Search ----------------
export function SearchPanel({ doc, store, onClose }: { doc: PDFDocumentProxy; store: ReaderStore; onClose: () => void }) {
  const search = useReader(store, (s) => s.search);
  const n = useReader(store, (s) => s.numPages);
  const noTextCount = useReader(store, (s) => Object.values(s.noText).filter(Boolean).length);
  const [q, setQ] = useState(search.query);
  const runId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  // Closing the panel stops a running search, so it cannot jump the reader later.
  useEffect(
    () => () => {
      runId.current++;
      const cur = store.getState().search;
      if (cur.running) store.getState().set({ search: { ...cur, running: false } });
    },
    [store],
  );

  async function run(query: string) {
    const id = ++runId.current;
    const needle = foldQuery(query);
    store.getState().set({ search: { query, hits: [], active: -1, running: !!needle, scanned: 0 } });
    if (!needle) return;
    const hits: SearchHit[] = [];
    let emptyPages = 0;
    for (let i = 0; i < n; i++) {
      if (id !== runId.current) return;
      const text = await getPageText(doc, i);
      if (!text.joined.trim()) emptyPages++;
      for (const h of findAll(text.folded, needle, 5000 - hits.length)) {
        const s0 = snippetStart(text.joined, h.start);
        const s1 = snippetEnd(text.joined, h.end);
        hits.push({ pageIndex: i, start: h.start, length: h.end - h.start, snippet: (s0 > 0 ? '…' : '') + text.joined.slice(s0, s1).trim() + (s1 < text.joined.length ? '…' : '') });
      }
      if (i % 20 === 19) {
        store.getState().set({ search: { query, hits: hits.slice(), active: -1, running: true, scanned: i + 1 } });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (id !== runId.current) return;
    store.getState().set({ search: { query, hits, active: hits.length ? 0 : -1, running: false, scanned: n } });
    if (emptyPages === n) store.getState().set({ noText: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, true])) });
    if (hits[0]) store.getState().goTo(hits[0].pageIndex);
  }

  const go = (delta: number) => {
    const s = store.getState().search;
    if (!s.hits.length) return;
    const active = (s.active + delta + s.hits.length) % s.hits.length;
    store.getState().set({ search: { ...s, active } });
    store.getState().goTo(s.hits[active]!.pageIndex);
  };

  return (
    <PanelFrame title="Search" onClose={onClose}>
      <form
        className="flex items-center gap-1 border-b border-line p-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
      >
        <label htmlFor="pdf-search" className="sr-only">
          Search in book
        </label>
        <input
          ref={input}
          id="pdf-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search text"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              go(-1);
            }
          }}
        />
        <IconButton label="Search" type="submit">
          <Search size={18} />
        </IconButton>
        <IconButton label="Previous match" onClick={() => go(-1)} disabled={!search.hits.length}>
          <ChevronUp size={18} />
        </IconButton>
        <IconButton label="Next match" onClick={() => go(1)} disabled={!search.hits.length}>
          <ChevronDown size={18} />
        </IconButton>
      </form>
      <p className="px-4 py-2 text-xs text-muted" aria-live="polite" data-testid="search-status">
        {search.running
          ? `Searching… ${search.scanned} of ${n} pages`
          : search.query
            ? search.hits.length
              ? `Match ${search.active + 1} of ${search.hits.length}${search.hits.length >= 5000 ? '+' : ''}`
              : 'No matches.'
            : 'Search the embedded text of this PDF.'}
      </p>
      {!search.running && search.query && search.hits.length === 0 && noTextCount > 0 && (
        <p className="mx-4 mb-2 rounded-lg bg-surface-2 p-3 text-xs">
          Some pages have no selectable text (for example scanned images), so they cannot be searched.
        </p>
      )}
      <ul className="px-2 pb-4">
        {search.hits.slice(0, 500).map((h, i) => (
          <li key={`${h.pageIndex}-${h.start}`}>
            <button
              type="button"
              onClick={() => {
                store.getState().set({ search: { ...store.getState().search, active: i } });
                store.getState().goTo(h.pageIndex);
              }}
              className={cx('block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2', i === search.active && 'bg-accent-soft')}
            >
              <span className="block text-xs font-semibold text-muted">Page {store.getState().label(h.pageIndex)}</span>
              <span className="line-clamp-2">{h.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}

// ---------------- Bookmarks ----------------
export function BookmarksPanel({ bookId, store, onClose }: { bookId: string; store: ReaderStore; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const list = useLiveQuery(() => getDb().bookmarks.where('bookId').equals(bookId).toArray(), [bookId]) ?? [];
  const current = useReader(store, (s) => s.current);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const sorted = [...list].sort((a, b) => (a.location.kind === 'pdf' ? a.location.pageIndex : 0) - (b.location.kind === 'pdf' ? b.location.pageIndex : 0));
  const fail = (e: unknown) => toast({ kind: 'error', message: errorMessage(e) });
  return (
    <PanelFrame title="Bookmarks" onClose={onClose}>
      <div className="border-b border-line p-2">
        <Button
          icon={<BookmarkPlus size={16} />}
          disabled={readOnly}
          onClick={() =>
            BookmarkRepository.add(bookId, { kind: 'pdf', pageIndex: current, xFraction: 0, yFraction: 0 }, `Page ${store.getState().label(current)}`).catch(fail)
          }
        >
          Bookmark this page
        </Button>
      </div>
      {sorted.length === 0 && <p className="p-4 text-sm text-muted">No bookmarks yet.</p>}
      <ul className="p-2">
        {sorted.map((b) => (
          <li key={b.id} className="flex items-center gap-1">
            {editing === b.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  BookmarkRepository.rename(b.id, text).then(() => setEditing(null), fail);
                }}
              >
                <label className="sr-only" htmlFor={`bm-${b.id}`}>
                  Bookmark name
                </label>
                <input id={`bm-${b.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" />
                <Button type="submit">Save</Button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="flex min-h-11 flex-1 flex-col justify-center rounded-lg px-3 text-left text-sm hover:bg-surface-2"
                  onClick={() => b.location.kind === 'pdf' && store.getState().goTo(b.location.pageIndex, b.location.yFraction)}
                >
                  <span>{b.label}</span>
                  {b.location.kind === 'pdf' && <span className="text-xs text-muted">Page {store.getState().label(b.location.pageIndex)}</span>}
                </button>
                <IconButton
                  label={`Rename bookmark ${b.label}`}
                  disabled={readOnly}
                  onClick={() => {
                    setEditing(b.id);
                    setText(b.label);
                  }}
                >
                  <Pencil size={16} />
                </IconButton>
                <IconButton label={`Remove bookmark ${b.label}`} disabled={readOnly} onClick={() => BookmarkRepository.remove(b.id).catch(fail)}>
                  <Trash2 size={16} />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
