import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { FolioDB, SCHEMA_VERSION } from '../../src/core/storage/db';

/** The exact v1 store definitions, frozen here so the test keeps describing v1. */
const V1_STORES = {
  books: 'id, &hash, title, lastOpenedAt, createdAt',
  bookFiles: 'bookId',
  covers: 'id, bookId',
  collections: 'id, title',
  memberships: '[collectionId+bookId], collectionId, bookId',
  annotations: 'id, bookId, [bookId+pageIndex]',
  notebooks: 'id, linkedBookId, updatedAt',
  notebookPages: 'id, notebookId, [notebookId+order], link.bookId',
  bookmarks: 'id, bookId',
  readingProgress: 'bookId',
  readingSessions: 'id, bookId, localDate',
  settings: 'key',
  metadata: 'key',
  inkCheckpoints: 'id, bookId',
};

describe('schema migrations (§12.4)', () => {
  it('upgrades a v1 library to v2 without losing data', async () => {
    const name = `folio-migrate-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(V1_STORES);
    await v1.open();
    const bookId = crypto.randomUUID();
    await v1.table('books').add({ id: bookId, hash: 'a'.repeat(64), title: 'Old book', createdAt: 1, lastOpenedAt: null });
    await v1.table('annotations').add({ id: crypto.randomUUID(), bookId, pageIndex: 0, type: 'ink', points: [], outline: [], style: {}, createdAt: 1, updatedAt: 1 });
    await v1.table('metadata').add({ key: 'schemaVersion', value: 1 });
    v1.close();

    expect(SCHEMA_VERSION).toBe(2);
    const db = new FolioDB(name);
    await db.open();
    expect(db.verno).toBe(2);
    expect((await db.books.get(bookId))?.title).toBe('Old book');
    expect(await db.annotations.count()).toBe(1);
    expect(await db.textMarks.count()).toBe(0);
    expect((await db.metadata.get('schemaVersion'))?.value).toBe(2);
    await db.textMarks.add({ id: crypto.randomUUID(), bookId, pageIndex: 0, kind: 'highlight', rects: [[0, 0, 10, 10]], color: '#ffd400', text: 'x', note: '', createdAt: 1, updatedAt: 1 });
    expect(await db.textMarks.where('[bookId+pageIndex]').equals([bookId, 0]).count()).toBe(1);
    await db.delete();
  });
});
