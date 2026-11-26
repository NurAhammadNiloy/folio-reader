import { getDb, ALL_TABLES } from './db';
import { canWrite } from './lease';
import { ReadOnlyError, toStorageError } from './errors';
import { trackWrite } from './writeTracker';
import { BackupError } from '../export/backupError';
import type { BackupBundle, ExportInput } from '../export/backupFormat';
import type { BookRecord } from './types';

export type RestoreMode = 'empty' | 'append' | 'replace';

export interface RestorePlan {
  mode: RestoreMode;
  libraryEmpty: boolean;
  conflicts: string[];
  books: number;
  annotations: number;
  notebooks: number;
  bookmarks: number;
}

export const BackupRepository = {
  /** Gather everything (or one book and its linked notes) for export. */
  async collect(scope: { kind: 'library' } | { kind: 'book'; bookId: string }): Promise<ExportInput> {
    const db = getDb();
    return db.transaction('r', ALL_TABLES.map((t) => db.table(t)), async () => {
      const books: BookRecord[] = scope.kind === 'library' ? await db.books.toArray() : [await db.books.get(scope.bookId)].filter((b): b is BookRecord => !!b);
      if (!books.length) throw new BackupError('invalid', 'There is nothing to back up yet.');
      const ids = new Set(books.map((b) => b.id));
      const inBooks = <T extends { bookId: string }>(rows: T[]) => rows.filter((r) => ids.has(r.bookId));
      const memberships = inBooks(await db.memberships.toArray());
      const allCollections = await db.collections.toArray();
      const collections = scope.kind === 'library' ? allCollections : allCollections.filter((c) => memberships.some((m) => m.collectionId === c.id));
      const notebooks =
        scope.kind === 'library' ? await db.notebooks.toArray() : await db.notebooks.where('linkedBookId').equals(scope.bookId).toArray();
      const nbIds = new Set(notebooks.map((n) => n.id));
      const notebookPages = (await db.notebookPages.toArray()).filter((p) => nbIds.has(p.notebookId));
      const files = new Map<string, Blob>();
      for (const f of await db.bookFiles.bulkGet([...ids])) {
        if (!f) throw new BackupError('invalid', 'An original PDF is missing from this device, so the backup cannot be complete.');
        files.set(f.bookId, f.blob);
      }
      const covers = new Map<string, { bookId: string; blob: Blob }>();
      for (const b of books) {
        if (!b.coverId) continue;
        const c = await db.covers.get(b.coverId);
        if (c) covers.set(c.id, { bookId: b.id, blob: c.blob });
      }
      const coverless = books.map((b) => (b.coverId && !covers.has(b.coverId) ? { ...b, coverId: null } : b));
      return {
        scope: scope.kind,
        files,
        covers,
        data: {
          books: coverless,
          collections,
          memberships,
          annotations: inBooks(await db.annotations.toArray()),
          notebooks,
          notebookPages,
          bookmarks: inBooks(await db.bookmarks.toArray()),
          readingProgress: inBooks(await db.readingProgress.toArray()),
          readingSessions: inBooks(await db.readingSessions.toArray()),
          settings: scope.kind === 'library' ? await db.settings.toArray() : [],
        },
      };
    });
  },

  /** Work out what a restore would do, without writing. */
  async plan(bundle: BackupBundle): Promise<RestorePlan> {
    const db = getDb();
    const libraryEmpty = (await db.books.count()) === 0 && (await db.notebooks.count()) === 0;
    const conflicts: string[] = [];
    if (!libraryEmpty) {
      for (const b of bundle.data.books) {
        if (await db.books.get(b.id)) conflicts.push(`“${b.title}” already exists (same ID).`);
        else if (await db.books.where('hash').equals(b.hash).first()) conflicts.push(`“${b.title}” is already in your library.`);
      }
      const checks: [string, string[]][] = [
        ['annotations', bundle.data.annotations.map((x) => x.id)],
        ['notebooks', bundle.data.notebooks.map((x) => x.id)],
        ['notebookPages', bundle.data.notebookPages.map((x) => x.id)],
        ['bookmarks', bundle.data.bookmarks.map((x) => x.id)],
        ['readingSessions', bundle.data.readingSessions.map((x) => x.id)],
      ];
      for (const [table, ids] of checks) {
        const found = (await db.table(table).bulkGet(ids)).filter(Boolean).length;
        if (found) conflicts.push(`${found} ${table} record(s) already exist.`);
      }
      for (const c of bundle.data.collections) {
        const existing = await db.collections.get(c.id);
        if (existing && existing.title !== c.title) conflicts.push(`Collection “${c.title}” conflicts with an existing collection.`);
      }
    }
    return {
      mode: libraryEmpty ? 'empty' : 'append',
      libraryEmpty,
      conflicts,
      books: bundle.data.books.length,
      annotations: bundle.data.annotations.length,
      notebooks: bundle.data.notebooks.length,
      bookmarks: bundle.data.bookmarks.length,
    };
  },

  /**
   * Commit a validated backup in ONE IndexedDB transaction. IndexedDB transactions are
   * atomic and durable: if anything fails (quota, crash, tab closed) the transaction
   * aborts and the previous library is untouched. All parsing and hashing happens
   * before the transaction starts.
   */
  async commit(bundle: BackupBundle, mode: RestoreMode, hooks?: { beforeWrite?: () => void }) {
    if (!canWrite()) throw new ReadOnlyError();
    const db = getDb();
    // Capacity check (best effort). Never deletes anything to make room.
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota !== undefined && est.usage !== undefined) {
        const free = est.quota - est.usage;
        if (free < bundle.expandedBytes * 1.2)
          throw new BackupError('capacity', 'There is not enough free browser storage on this device to restore this backup. Nothing was changed.');
      }
    } catch (e) {
      if (e instanceof BackupError) throw e;
    }
    const plan = await this.plan(bundle);
    if (mode === 'empty' && !plan.libraryEmpty) throw new BackupError('conflict', 'The library is no longer empty. Choose append or replace.');
    if (mode === 'append' && plan.conflicts.length) throw new BackupError('conflict', `Cannot append: ${plan.conflicts[0]}`);
    const d = bundle.data;
    await trackWrite(async () => {
      try {
        await db.transaction('rw', ALL_TABLES.map((t) => db.table(t)), async () => {
          if (mode === 'replace') for (const t of ALL_TABLES) if (t !== 'metadata') await db.table(t).clear();
          hooks?.beforeWrite?.();
          await db.books.bulkAdd(d.books);
          for (const [bookId, bytes] of bundle.files) {
            const book = d.books.find((b) => b.id === bookId)!;
            const mime = book.format === 'epub' ? 'application/epub+zip' : 'application/pdf';
            await db.bookFiles.add({ bookId, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), mime, size: bytes.length, checksum: book.hash });
          }
          for (const c of d.covers) {
            const cov = bundle.covers.get(c.id)!;
            await db.covers.add({ id: c.id, bookId: c.bookId, blob: new Blob([cov.bytes as Uint8Array<ArrayBuffer>], { type: cov.type }) });
          }
          await db.collections.bulkPut(d.collections);
          await db.memberships.bulkPut(d.memberships);
          await db.annotations.bulkAdd(d.annotations);
          await db.notebooks.bulkAdd(d.notebooks);
          await db.notebookPages.bulkAdd(d.notebookPages);
          await db.bookmarks.bulkAdd(d.bookmarks);
          await db.readingProgress.bulkPut(d.readingProgress);
          await db.readingSessions.bulkAdd(d.readingSessions);
          if (mode !== 'append') await db.settings.bulkPut(d.settings);
        });
      } catch (err) {
        if (err instanceof BackupError) throw err;
        throw toStorageError(err, 'The restore could not be completed. Your existing library was not changed.');
      }
    });
  },
};
