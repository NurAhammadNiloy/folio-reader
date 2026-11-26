import { getDb } from './db';
import { mutate } from './mutate';
import { newId } from './ids';
import { StorageError } from './errors';
import type { BookLocation, BookmarkRecord } from './types';

export const BookmarkRepository = {
  async list(bookId: string): Promise<BookmarkRecord[]> {
    return getDb().bookmarks.where('bookId').equals(bookId).toArray();
  },
  async add(bookId: string, location: BookLocation, label: string): Promise<BookmarkRecord> {
    const now = Date.now();
    const rec: BookmarkRecord = { id: newId(), bookId, location, label: label.trim() || 'Bookmark', createdAt: now, updatedAt: now };
    const db = getDb();
    await mutate(
      () => [db.bookmarks, db.books],
      async () => {
        if (!(await db.books.get(bookId))) throw new StorageError('not-found', 'That book no longer exists.');
        await db.bookmarks.add(rec);
      },
    );
    return rec;
  },
  async rename(id: string, label: string) {
    const db = getDb();
    await mutate(
      () => [db.bookmarks],
      async () => {
        await db.bookmarks.update(id, { label: label.trim() || 'Bookmark', updatedAt: Date.now() });
      },
    );
  },
  async remove(id: string) {
    const db = getDb();
    await mutate(
      () => [db.bookmarks],
      async () => {
        await db.bookmarks.delete(id);
      },
    );
  },
};
