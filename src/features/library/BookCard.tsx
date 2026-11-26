import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { MoreHorizontal, Star, BookOpen } from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { LibraryRepository } from '../../core/storage/libraryRepository';
import { ProgressRepository } from '../../core/storage/progressRepository';
import { Menu, cx, formatBytes } from '../../components/ui';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { errorMessage, useApp } from '../../app/appStore';
import type { BookRecord, CollectionRecord, MembershipRecord, ReadingProgressRecord } from '../../core/storage/types';
import { BookCollectionsDialog, DeleteBookDialog, EditDetailsDialog, ConfirmDialog } from './dialogs';
import { downloadOriginal, exportAnnotated } from '../export/bookActions';
import { exportBookPackage } from '../backup/backupActions';

function Cover({ book, className }: { book: BookRecord; className?: string }) {
  const cover = useLiveQuery(() => (book.coverId ? getDb().covers.get(book.coverId) : undefined), [book.coverId]);
  const url = useObjectUrl(cover?.blob);
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-paper shadow-[var(--shadow-book)]', className)}>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full flex-col justify-between bg-accent-soft p-3 text-left">
          <BookOpen size={20} className="text-accent" aria-hidden />
          <span className="line-clamp-4 font-serif text-sm font-semibold text-ink">{book.title}</span>
        </div>
      )}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/15 to-transparent" aria-hidden />
    </div>
  );
}

export function positionText(book: BookRecord, p: ReadingProgressRecord | undefined) {
  if (p?.completedAt) return 'Completed';
  const loc = p?.lastLocation;
  if (!loc || loc.kind !== 'pdf') return 'Not started';
  return `Page ${loc.pageIndex + 1} of ${book.pageCount}`;
}

export function viewedText(book: BookRecord, p: ReadingProgressRecord | undefined) {
  const n = p?.qualifiedPages.length ?? 0;
  if (!n) return null;
  return `${Math.round((n / book.pageCount) * 100)}% of pages viewed`;
}

export function ContinueCard({ book, progress }: { book: BookRecord; progress?: ReadingProgressRecord }) {
  return (
    <Link
      to={`/reader/${book.id}`}
      className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-soft)] hover:bg-surface-2"
    >
      <Cover book={book} className="aspect-[3/4] w-14 flex-none" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{book.title}</span>
        <span className="block text-sm text-muted">{positionText(book, progress)}</span>
        <span className="mt-1 block text-sm font-semibold text-accent">Resume</span>
      </span>
    </Link>
  );
}

export function BookCard({
  book,
  progress,
  collections,
  memberships,
}: {
  book: BookRecord;
  progress?: ReadingProgressRecord;
  collections: CollectionRecord[];
  memberships: MembershipRecord[];
}) {
  const navigate = useNavigate();
  const toast = useApp((s) => s.toast);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const [dialog, setDialog] = useState<null | 'edit' | 'collections' | 'delete' | 'reset'>(null);
  const viewed = viewedText(book, progress);
  const frac = progress ? Math.min(1, progress.qualifiedPages.length / book.pageCount) : 0;

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    fn()
      .then(() => ok && toast({ kind: 'success', message: ok }))
      .catch((e) => toast({ kind: 'error', message: errorMessage(e) }));

  return (
    <article className="group flex flex-col" aria-label={book.title}>
      <Link to={`/reader/${book.id}`} className="block rounded-md" aria-label={`Open ${book.title}`}>
        <Cover book={book} className="aspect-[3/4] w-full transition-transform group-hover:-translate-y-0.5" />
      </Link>
      <div className="mt-2 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{book.title}</h3>
          {book.author && <p className="truncate text-xs text-muted">{book.author}</p>}
          <p className="mt-0.5 text-xs text-muted">
            PDF · {formatBytes(book.fileSize)} · {book.pageCount} pp
          </p>
          <p className="text-xs text-muted">{positionText(book, progress)}</p>
          {viewed && (
            <div className="mt-1" title={viewed}>
              <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full bg-accent" style={{ width: `${frac * 100}%` }} />
              </div>
              <span className="sr-only">{viewed}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label={book.favourite ? `Remove ${book.title} from favourites` : `Add ${book.title} to favourites`}
          aria-pressed={book.favourite}
          disabled={readOnly}
          onClick={() => run(() => LibraryRepository.update(book.id, { favourite: !book.favourite }))}
          className="inline-flex h-11 w-9 flex-none items-center justify-center rounded-lg text-muted hover:bg-surface-2"
        >
          <Star size={16} className={book.favourite ? 'fill-accent text-accent' : ''} />
        </button>
        <Menu
          label={`More actions for ${book.title}`}
          trigger={<MoreHorizontal size={18} />}
          items={[
            { label: 'Open', onSelect: () => navigate(`/reader/${book.id}`) },
            { label: 'Study with notebook', onSelect: () => navigate(`/study/${book.id}`) },
            'sep',
            { label: 'Edit title and author…', onSelect: () => setDialog('edit'), disabled: readOnly },
            { label: 'Collections…', onSelect: () => setDialog('collections'), disabled: readOnly },
            progress?.completedAt
              ? { label: 'Mark as not completed', onSelect: () => run(() => ProgressRepository.setCompleted(book.id, false)), disabled: readOnly }
              : { label: 'Mark as completed', onSelect: () => run(() => ProgressRepository.setCompleted(book.id, true), 'Marked as completed'), disabled: readOnly },
            { label: 'Reset progress…', onSelect: () => setDialog('reset'), disabled: readOnly },
            'sep',
            { label: 'Download original PDF', onSelect: () => run(() => downloadOriginal(book)) },
            {
              label: book.encrypted ? 'Annotated export unavailable (encrypted PDF)' : 'Export annotated PDF',
              onSelect: () => run(async () => {
                const { marks } = await exportAnnotated(book);
                toast({ kind: 'success', message: marks ? `Exported a copy with ${marks} marks.` : 'Exported a copy (this book has no marks yet).' });
              }),
              disabled: book.encrypted,
            },
            { label: 'Export book backup (.folio-backup)', onSelect: () => run(() => exportBookPackage(book.id), 'Book backup downloaded') },
            'sep',
            { label: 'Delete…', onSelect: () => setDialog('delete'), danger: true, disabled: readOnly },
          ]}
        />
      </div>
      <EditDetailsDialog book={book} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <BookCollectionsDialog book={book} collections={collections} memberships={memberships} open={dialog === 'collections'} onClose={() => setDialog(null)} />
      <DeleteBookDialog book={book} open={dialog === 'delete'} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'reset'}
        title="Reset reading progress?"
        body="This clears pages viewed and the completed flag for this book. Your marks, bookmarks, notes and current page are kept."
        confirmLabel="Reset progress"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          void run(() => ProgressRepository.resetProgress(book.id), 'Progress reset');
        }}
      />
    </article>
  );
}
