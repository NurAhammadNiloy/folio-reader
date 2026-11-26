import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2, Pencil } from 'lucide-react';
import { Button, Dialog, TextField, IconButton } from '../../components/ui';
import { LibraryRepository, type DeleteMode } from '../../core/storage/libraryRepository';
import { getDb } from '../../core/storage/db';
import { errorMessage, useApp } from '../../app/appStore';
import type { BookRecord, CollectionRecord, MembershipRecord } from '../../core/storage/types';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

export function EditDetailsDialog({ book, open, onClose }: { book: BookRecord; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle(book.title);
      setAuthor(book.author);
      setError(null);
    }
  }, [open, book.title, book.author]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit details"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={`edit-${book.id}`}>
            Save
          </Button>
        </>
      }
    >
      <form
        id={`edit-${book.id}`}
        onSubmit={(e) => {
          e.preventDefault();
          LibraryRepository.update(book.id, { title, author })
            .then(onClose)
            .catch((err) => setError(errorMessage(err)));
        }}
      >
        <TextField label="Title" value={title} onChange={setTitle} autoFocus />
        <TextField label="Author (optional)" value={author} onChange={setAuthor} />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

export function BookCollectionsDialog({
  book,
  collections,
  memberships,
  open,
  onClose,
}: {
  book: BookRecord;
  collections: CollectionRecord[];
  memberships: MembershipRecord[];
  open: boolean;
  onClose: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState('');
  const mine = new Set(memberships.filter((m) => m.bookId === book.id).map((m) => m.collectionId));
  return (
    <Dialog open={open} onClose={onClose} title={`Collections for “${book.title}”`} footer={<Button onClick={onClose}>Done</Button>}>
      {collections.length === 0 && <p className="mb-3 text-muted">No collections yet. Create one below.</p>}
      <ul className="mb-4 space-y-1">
        {collections.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-surface-2">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--accent)]"
                checked={mine.has(c.id)}
                onChange={(e) =>
                  LibraryRepository.setMembership(c.id, book.id, e.target.checked).catch((err) => toast({ kind: 'error', message: errorMessage(err) }))
                }
              />
              {c.title}
            </label>
          </li>
        ))}
      </ul>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          LibraryRepository.createCollection(name)
            .then((c) => LibraryRepository.setMembership(c.id, book.id, true))
            .then(() => setName(''))
            .catch((err) => toast({ kind: 'error', message: errorMessage(err) }));
        }}
      >
        <div className="flex-1">
          <TextField label="New collection" value={name} onChange={setName} />
        </div>
        <Button type="submit" className="mb-3" disabled={!name.trim()}>
          Add
        </Button>
      </form>
    </Dialog>
  );
}

export function CollectionManagerDialog({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (m: string) => void }) {
  const collections = useLiveQuery(() => getDb().collections.orderBy('title').toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  return (
    <Dialog open={open} onClose={onClose} title="Collections" footer={<Button onClick={onClose}>Done</Button>}>
      <ul className="mb-4 divide-y divide-line">
        {collections.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1">
            {editing === c.id ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  LibraryRepository.renameCollection(c.id, editName)
                    .then(() => setEditing(null))
                    .catch((err) => onError(errorMessage(err)));
                }}
              >
                <label className="sr-only" htmlFor={`rn-${c.id}`}>
                  Collection name
                </label>
                <input id={`rn-${c.id}`} autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3" />
                <Button type="submit">Save</Button>
              </form>
            ) : (
              <>
                <span className="flex-1">{c.title}</span>
                <IconButton
                  label={`Rename ${c.title}`}
                  onClick={() => {
                    setEditing(c.id);
                    setEditName(c.title);
                  }}
                >
                  <Pencil size={16} />
                </IconButton>
                <IconButton label={`Delete collection ${c.title}`} onClick={() => LibraryRepository.deleteCollection(c.id).catch((err) => onError(errorMessage(err)))}>
                  <Trash2 size={16} />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mb-2 text-xs text-muted">Deleting a collection keeps its books.</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          LibraryRepository.createCollection(name)
            .then(() => setName(''))
            .catch((err) => onError(errorMessage(err)));
        }}
      >
        <div className="flex-1">
          <TextField label="New collection" value={name} onChange={setName} />
        </div>
        <Button type="submit" className="mb-3" disabled={!name.trim()}>
          Create
        </Button>
      </form>
    </Dialog>
  );
}

export function DeleteBookDialog({ book, open, onClose }: { book: BookRecord; open: boolean; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const linked = useLiveQuery(() => (open ? LibraryRepository.linkedContent(book.id) : undefined), [open, book.id]);
  const [mode, setMode] = useState<DeleteMode>('detach-notebooks');
  const hasNotebooks = (linked?.notebooks ?? 0) > 0;
  const total = (linked?.annotations ?? 0) + (linked?.bookmarks ?? 0);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete “${book.title}”?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() =>
              LibraryRepository.deleteBook(book.id, mode)
                .then(() => {
                  onClose();
                  toast({ kind: 'success', message: `Deleted “${book.title}”.` });
                })
                .catch((err) => toast({ kind: 'error', message: errorMessage(err) }))
            }
          >
            Delete book
          </Button>
        </>
      }
    >
      <p className="mb-3">This removes the PDF from this device. It cannot be undone unless you have a backup.</p>
      {linked && total > 0 && (
        <p className="mb-3 rounded-lg bg-surface-2 p-3">
          Also deleted: {linked.annotations} {linked.annotations === 1 ? 'mark' : 'marks'} and {linked.bookmarks} {linked.bookmarks === 1 ? 'bookmark' : 'bookmarks'}.
        </p>
      )}
      {hasNotebooks && (
        <fieldset className="mb-2 space-y-1">
          <legend className="mb-1 font-medium">{linked!.notebooks} linked notebook(s)</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name={`del-${book.id}`} checked={mode === 'detach-notebooks'} onChange={() => setMode('detach-notebooks')} className="h-5 w-5" />
            Keep notebooks (links to this book will show as missing)
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name={`del-${book.id}`} checked={mode === 'delete-associated'} onChange={() => setMode('delete-associated')} className="h-5 w-5" />
            Delete notebooks too
          </label>
        </fieldset>
      )}
    </Dialog>
  );
}
