import { getDb } from './db';
import { mutate } from './mutate';
import { StorageError } from './errors';
import { newId } from './ids';
import type { BookFileRecord, BookFormat, BookRecord, CollectionRecord, CoverRecord, MembershipRecord, ReadingDirection } from './types';

export interface NewBookInput {
  format?: BookFormat;
  direction?: ReadingDirection;
  title: string;
  author: string;
  hash: string;
  pageCount: number;
  fileName: string;
  encrypted: boolean;
  file: Blob;
  mime: string;
  cover: Blob | null;
}

export type DeleteMode = 'delete-associated' | 'detach-notebooks';

export const LibraryRepository = {
  async list(): Promise<BookRecord[]> {
    return getDb().books.toArray();
  },

  async get(id: string): Promise<BookRecord | undefined> {
    return getDb().books.get(id);
  },

  async findByHash(hash: string): Promise<BookRecord | undefined> {
    return getDb().books.where('hash').equals(hash).first();
  },

  async getFile(bookId: string): Promise<BookFileRecord | undefined> {
    return getDb().bookFiles.get(bookId);
  },

  async getCover(coverId: string): Promise<CoverRecord | undefined> {
    return getDb().covers.get(coverId);
  },

  /**
   * Persist a validated import atomically: book record, original bytes and cover are
   * written in one transaction, so a failure never leaves a partial book (LIB-01).
   */
  async addBook(input: NewBookInput): Promise<BookRecord> {
    const now = Date.now();
    const id = newId();
    const coverId = input.cover ? newId() : null;
    const book: BookRecord = {
      id,
      format: input.format ?? 'pdf',
      title: input.title,
      author: input.author,
      hash: input.hash,
      coverId,
      pageCount: input.pageCount,
      direction: input.direction ?? 'ltr',
      fileName: input.fileName,
      fileSize: input.file.size,
      encrypted: input.encrypted,
      favourite: false,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    };
    // Read the bytes before the transaction (awaiting non-IndexedDB work inside it would end it).
    const fileBytes = await input.file.arrayBuffer();
    const coverBytes = input.cover ? await input.cover.arrayBuffer() : null;
    const db = getDb();
    await mutate(
      () => [db.books, db.bookFiles, db.covers],
      async () => {
        const dup = await db.books.where('hash').equals(input.hash).first();
        if (dup) throw new StorageError('duplicate', `“${dup.title}” is already in your library.`);
        await db.books.add(book);
        await db.bookFiles.add({
          bookId: id,
          blob: fileBytes,
          mime: input.mime,
          size: input.file.size,
          checksum: input.hash,
        });
        if (input.cover && coverBytes && coverId) await db.covers.add({ id: coverId, bookId: id, blob: coverBytes, type: input.cover.type || 'image/webp' });
      },
    );
    return book;
  },

  async update(id: string, patch: Partial<Pick<BookRecord, 'title' | 'author' | 'favourite' | 'direction'>>) {
    const db = getDb();
    const clean = { ...patch };
    if (clean.title !== undefined) {
      clean.title = clean.title.trim();
      if (!clean.title) throw new StorageError('constraint', 'A title is required.');
    }
    if (clean.author !== undefined) clean.author = clean.author.trim();
    await mutate(
      () => [db.books],
      async () => {
        const n = await db.books.update(id, { ...clean, updatedAt: Date.now() });
        if (!n) throw new StorageError('not-found', 'That book no longer exists.');
      },
    );
  },

  async markOpened(id: string) {
    const db = getDb();
    await mutate(
      () => [db.books],
      async () => {
        await db.books.update(id, { lastOpenedAt: Date.now() });
      },
    );
  },

  /** Counts of user-created content linked to a book, for the delete warning. */
  async linkedContent(bookId: string) {
    const db = getDb();
    const [annotations, bookmarks, notebooks, linkedPages] = await Promise.all([
      db.annotations.where('bookId').equals(bookId).count(),
      db.bookmarks.where('bookId').equals(bookId).count(),
      db.notebooks.where('linkedBookId').equals(bookId).count(),
      db.notebookPages.where('link.bookId').equals(bookId).count(),
    ]);
    return { annotations, bookmarks, notebooks, linkedPages };
  },

  /**
   * Delete a book and its durable data in a single transaction. Notebooks linked to
   * the book are either deleted or detached (their page links become explicit
   * missing links), per the user's choice.
   */
  async deleteBook(bookId: string, mode: DeleteMode) {
    const db = getDb();
    await mutate(
      () => [
        db.books,
        db.bookFiles,
        db.covers,
        db.memberships,
        db.annotations,
        db.bookmarks,
        db.readingProgress,
        db.readingSessions,
        db.notebooks,
        db.notebookPages,
        db.inkCheckpoints,
      ],
      async () => {
        const book = await db.books.get(bookId);
        if (!book) throw new StorageError('not-found', 'That book no longer exists.');
        await db.bookFiles.delete(bookId);
        await db.covers.where('bookId').equals(bookId).delete();
        await db.memberships.where('bookId').equals(bookId).delete();
        await db.annotations.where('bookId').equals(bookId).delete();
        await db.bookmarks.where('bookId').equals(bookId).delete();
        await db.readingProgress.delete(bookId);
        await db.readingSessions.where('bookId').equals(bookId).delete();
        await db.inkCheckpoints.where('bookId').equals(bookId).delete();
        const notebooks = await db.notebooks.where('linkedBookId').equals(bookId).toArray();
        if (mode === 'delete-associated') {
          for (const nb of notebooks) {
            await db.notebookPages.where('notebookId').equals(nb.id).delete();
            await db.notebooks.delete(nb.id);
          }
        } else {
          for (const nb of notebooks) await db.notebooks.update(nb.id, { linkedBookId: null, updatedAt: Date.now() });
        }
        // Pages in surviving notebooks keep their link so it shows as a missing link.
        await db.books.delete(bookId);
      },
    );
  },

  // Collections -------------------------------------------------------------

  async listCollections(): Promise<CollectionRecord[]> {
    return getDb().collections.orderBy('title').toArray();
  },

  async listMemberships(): Promise<MembershipRecord[]> {
    return getDb().memberships.toArray();
  },

  async createCollection(title: string): Promise<CollectionRecord> {
    const t = title.trim();
    if (!t) throw new StorageError('constraint', 'A collection name is required.');
    const db = getDb();
    const rec: CollectionRecord = { id: newId(), title: t, createdAt: Date.now() };
    await mutate(
      () => [db.collections],
      async () => {
        const existing = await db.collections.where('title').equalsIgnoreCase(t).first();
        if (existing) throw new StorageError('duplicate', `A collection called “${t}” already exists.`);
        await db.collections.add(rec);
      },
    );
    return rec;
  },

  async renameCollection(id: string, title: string) {
    const t = title.trim();
    if (!t) throw new StorageError('constraint', 'A collection name is required.');
    const db = getDb();
    await mutate(
      () => [db.collections],
      async () => {
        await db.collections.update(id, { title: t });
      },
    );
  },

  async deleteCollection(id: string) {
    const db = getDb();
    await mutate(
      () => [db.collections, db.memberships],
      async () => {
        await db.memberships.where('collectionId').equals(id).delete();
        await db.collections.delete(id);
      },
    );
  },

  async setMembership(collectionId: string, bookId: string, member: boolean) {
    const db = getDb();
    await mutate(
      () => [db.memberships, db.collections, db.books],
      async () => {
        if (member) {
          if (!(await db.collections.get(collectionId)) || !(await db.books.get(bookId)))
            throw new StorageError('not-found', 'That book or collection no longer exists.');
          await db.memberships.put({ collectionId, bookId, addedAt: Date.now() });
        } else {
          await db.memberships.delete([collectionId, bookId]);
        }
      },
    );
  },
};
