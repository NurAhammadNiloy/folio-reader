import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { NotebookPen, PenLine, Trash2, Plus, Bookmark } from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { NotebookRepository } from '../../core/storage/notebookRepository';
import { Button, IconButton } from '../../components/ui';
import { errorMessage, useApp } from '../../app/appStore';
import { ConfirmDialog } from '../library/dialogs';

export function NotesPage() {
  const toast = useApp((s) => s.toast);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const notebooks = useLiveQuery(() => getDb().notebooks.toArray(), []);
  const pages = useLiveQuery(() => getDb().notebookPages.toArray(), []);
  const books = useLiveQuery(() => getDb().books.toArray(), []);
  const annotations = useLiveQuery(() => getDb().annotations.toArray(), []);
  const bookmarks = useLiveQuery(() => getDb().bookmarks.toArray(), []);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const bookById = useMemo(() => new Map((books ?? []).map((b) => [b.id, b])), [books]);

  const marksByBook = useMemo(() => {
    const m = new Map<string, Map<number, { count: number; last: number }>>();
    for (const a of annotations ?? []) {
      const pm = m.get(a.bookId) ?? new Map();
      const cur = pm.get(a.pageIndex) ?? { count: 0, last: 0 };
      pm.set(a.pageIndex, { count: cur.count + 1, last: Math.max(cur.last, a.updatedAt) });
      m.set(a.bookId, pm);
    }
    return m;
  }, [annotations]);

  const loading = !notebooks || !pages || !books || !annotations || !bookmarks;
  const sortedNbs = [...(notebooks ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const empty = !loading && sortedNbs.length === 0 && marksByBook.size === 0 && (bookmarks?.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-4 sm:px-6 lg:pt-8">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="mr-auto font-serif text-3xl font-semibold tracking-tight">Notes</h1>
        <Button
          icon={<Plus size={16} />}
          disabled={readOnly}
          onClick={() => NotebookRepository.create('Notebook', null).catch((e) => toast({ kind: 'error', message: errorMessage(e) }))}
        >
          New notebook
        </Button>
      </header>
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {empty && (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-muted">
          Notebooks, marks and bookmarks from all your books appear here. Open a book and choose Study or the pen to begin.
        </p>
      )}
      {sortedNbs.length > 0 && (
        <section aria-labelledby="nb-h" className="mb-8">
          <h2 id="nb-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Notebooks
          </h2>
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {sortedNbs.map((nb) => {
              const count = (pages ?? []).filter((p) => p.notebookId === nb.id).length;
              const book = nb.linkedBookId ? bookById.get(nb.linkedBookId) : undefined;
              const href = book ? `/study/${book.id}?notebook=${nb.id}` : `/notes/${nb.id}`;
              return (
                <li key={nb.id} className="flex items-center gap-3 px-4 py-2">
                  <NotebookPen size={18} className="text-accent" aria-hidden />
                  <Link to={href} className="min-w-0 flex-1 py-2">
                    <span className="block truncate font-medium">{nb.title}</span>
                    <span className="block text-xs text-muted">
                      {book ? `Linked to “${book.title}” · ` : nb.linkedBookId ? 'Linked book was deleted · ' : ''}
                      {count} {count === 1 ? 'page' : 'pages'} · Edited {new Date(nb.updatedAt).toLocaleString()}
                    </span>
                  </Link>
                  <IconButton label={`Delete notebook ${nb.title}`} onClick={() => setToDelete(nb.id)} disabled={readOnly}>
                    <Trash2 size={16} />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {marksByBook.size > 0 && (
        <section aria-labelledby="marks-h" className="mb-8">
          <h2 id="marks-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Marks in books
          </h2>
          {[...marksByBook].map(([bookId, pagesMap]) => {
            const book = bookById.get(bookId);
            if (!book) return null;
            return (
              <div key={bookId} className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <h3 className="mb-2 font-medium">{book.title}</h3>
                <ul className="flex flex-wrap gap-2">
                  {[...pagesMap].sort((a, b) => a[0] - b[0]).map(([pageIndex, info]) => (
                    <li key={pageIndex}>
                      <Link to={`/study/${bookId}?page=${pageIndex}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-3 text-sm hover:bg-surface-2" title={`Last edited ${new Date(info.last).toLocaleString()}`}>
                        <PenLine size={14} aria-hidden /> Page {pageIndex + 1} · {info.count}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
      {(bookmarks?.length ?? 0) > 0 && (
        <section aria-labelledby="bm-h">
          <h2 id="bm-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Bookmarks
          </h2>
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {bookmarks!.map((b) => {
              const book = bookById.get(b.bookId);
              if (!book || b.location.kind !== 'pdf') return null;
              return (
                <li key={b.id}>
                  <Link to={`/study/${b.bookId}?page=${b.location.pageIndex}`} className="flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                    <Bookmark size={16} className="text-accent" aria-hidden />
                    <span className="flex-1">{b.label}</span>
                    <span className="text-xs text-muted">{book.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete notebook?"
        body="All pages, handwriting and typed notes in this notebook will be deleted from this device."
        confirmLabel="Delete notebook"
        danger
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const id = toDelete!;
          setToDelete(null);
          NotebookRepository.remove(id).catch((e) => toast({ kind: 'error', message: errorMessage(e) }));
        }}
      />
    </div>
  );
}
