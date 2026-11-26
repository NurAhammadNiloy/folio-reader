import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, Search, Star, Plus, ShieldCheck, Upload } from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { Button, cx } from '../../components/ui';
import { useApp } from '../../app/appStore';
import { BookCard, ContinueCard } from './BookCard';
import { ImportPanel, type ImportItem } from './ImportPanel';
import { importPdf } from './importBooks';
import { PasswordDialog, usePasswordPrompt } from './PasswordDialog';
import { CollectionManagerDialog } from './dialogs';
import type { BookRecord, ReadingProgressRecord } from '../../core/storage/types';

type Sort = 'recent' | 'title' | 'progress';

export function progressFraction(book: BookRecord, p: ReadingProgressRecord | undefined) {
  if (!p || book.pageCount === 0) return 0;
  return Math.min(1, p.qualifiedPages.length / book.pageCount);
}

export function LibraryPage() {
  const books = useLiveQuery(() => getDb().books.toArray(), []);
  const progress = useLiveQuery(() => getDb().readingProgress.toArray(), []);
  const collections = useLiveQuery(() => getDb().collections.orderBy('title').toArray(), []);
  const memberships = useLiveQuery(() => getDb().memberships.toArray(), []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [filter, setFilter] = useState<string>('all');
  const [items, setItems] = useState<ImportItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [manageCollections, setManageCollections] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const queue = useRef<File[]>([]);
  const navigate = useNavigate();
  const toast = useApp((s) => s.toast);
  const lease = useApp((s) => s.lease);
  const pw = usePasswordPrompt();

  const progressById = useMemo(() => new Map((progress ?? []).map((p) => [p.bookId, p])), [progress]);

  const visible = useMemo(() => {
    if (!books) return [];
    const q = query.trim().toLocaleLowerCase();
    let list = books.filter((b) => !q || b.title.toLocaleLowerCase().includes(q) || b.author.toLocaleLowerCase().includes(q));
    if (filter === 'favourites') list = list.filter((b) => b.favourite);
    else if (filter !== 'all') {
      const ids = new Set((memberships ?? []).filter((m) => m.collectionId === filter).map((m) => m.bookId));
      list = list.filter((b) => ids.has(b.id));
    }
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    list.sort((a, b) => {
      if (sort === 'title') return collator.compare(a.title, b.title);
      if (sort === 'progress') return progressFraction(b, progressById.get(b.id)) - progressFraction(a, progressById.get(a.id));
      return (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt);
    });
    return list;
  }, [books, query, sort, filter, memberships, progressById]);

  const recent = useMemo(
    () => (books ?? []).filter((b) => b.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!).slice(0, 3),
    [books],
  );

  async function drain() {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const file = queue.current.shift()!;
      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
      setItems((s) => [...s, { key, name: file.name, state: 'working' }]);
      const result = await importPdf(file, pw.ask);
      setItems((s) => s.map((it) => (it.key === key ? { ...it, state: 'done', result } : it)));
    }
    busy.current = false;
  }

  function enqueue(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    queue.current.push(...list);
    void drain();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files);
  }

  const loading = books === undefined;
  const empty = !loading && books.length === 0;
  const readOnly = lease !== 'owner';

  return (
    <div
      className="relative mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-10 lg:pt-8"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        data-testid="import-input"
        onChange={(e) => {
          if (e.target.files) enqueue(e.target.files);
          e.target.value = '';
        }}
      />
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-serif text-3xl font-semibold tracking-tight">Library</h1>
        {!empty && (
          <label className="relative order-3 w-full sm:order-none sm:w-64">
            <span className="sr-only">Search title or author</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or author"
              className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm"
            />
          </label>
        )}
        <Button variant="primary" icon={<FilePlus2 size={18} aria-hidden />} onClick={() => input.current?.click()} disabled={readOnly}>
          Import PDF
        </Button>
      </header>

      <ImportPanel items={items} onClear={() => setItems((s) => s.filter((i) => i.state === 'working'))} onOpen={(id) => navigate(`/reader/${id}`)} />

      {loading && <p className="text-sm text-muted">Loading your library…</p>}

      {empty && (
        <section className="mx-auto mt-10 max-w-xl rounded-[var(--radius-card)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-soft)]">
          <img src="./icons/icon-192.png" alt="" className="mx-auto mb-4 h-14 w-14 rounded-2xl" />
          <h2 className="mb-2 font-serif text-2xl font-semibold">Your bookshelf is empty</h2>
          <p className="mb-6 text-muted">
            Import a PDF to start reading. Folio works without an account and keeps your books, marks and notes on this device only.
          </p>
          <Button variant="primary" icon={<FilePlus2 size={18} aria-hidden />} onClick={() => input.current?.click()} disabled={readOnly}>
            Import your first PDF
          </Button>
          <ul className="mt-6 space-y-2 text-left text-sm text-muted">
            <li className="flex gap-2">
              <ShieldCheck size={16} className="mt-0.5 flex-none text-accent" aria-hidden />
              Files are never uploaded. Browser storage can be cleared by you or the browser, so export a backup from Settings.
            </li>
            <li className="flex gap-2">
              <Upload size={16} className="mt-0.5 flex-none text-accent" aria-hidden />
              Supported: PDF files up to 100 MB and 2,000 pages. EPUB is not supported yet.
            </li>
          </ul>
        </section>
      )}

      {!empty && !loading && (
        <>
          {recent.length > 0 && filter === 'all' && !query && (
            <section aria-labelledby="continue-h" className="mb-8">
              <h2 id="continue-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Continue reading
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((b) => (
                  <ContinueCard key={b.id} book={b} progress={progressById.get(b.id)} />
                ))}
              </div>
            </section>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter and sort">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All books
            </FilterChip>
            <FilterChip active={filter === 'favourites'} onClick={() => setFilter('favourites')}>
              <Star size={14} aria-hidden /> Favourites
            </FilterChip>
            {(collections ?? []).map((c) => (
              <FilterChip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
                {c.title}
              </FilterChip>
            ))}
            <button
              type="button"
              onClick={() => setManageCollections(true)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-accent hover:bg-surface-2"
            >
              <Plus size={14} aria-hidden /> Collections
            </button>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted">
              Sort
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-11 rounded-xl border border-line bg-surface px-2 text-ink">
                <option value="recent">Recent</option>
                <option value="title">Title</option>
                <option value="progress">Progress</option>
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-muted">No books match.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5" aria-label="Books">
              {visible.map((b) => (
                <li key={b.id}>
                  <BookCard book={b} progress={progressById.get(b.id)} collections={collections ?? []} memberships={memberships ?? []} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/15 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-lg font-medium">Drop PDF files to import</div>
        </div>
      )}
      <PasswordDialog prompt={pw} />
      <CollectionManagerDialog open={manageCollections} onClose={() => setManageCollections(false)} onError={(m) => toast({ kind: 'error', message: m })} />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-sm',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
