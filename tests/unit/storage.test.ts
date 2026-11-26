import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolioDB, setDbForTests, getDb } from '../../src/core/storage/db';
import { LibraryRepository } from '../../src/core/storage/libraryRepository';
import { ProgressRepository } from '../../src/core/storage/progressRepository';
import { resetLeaseForTests, acquireLease, getLeaseState } from '../../src/core/storage/lease';
import { ReadOnlyError, StorageError, toStorageError } from '../../src/core/storage/errors';
import { pendingWrites } from '../../src/core/storage/writeTracker';
import { sha256Hex } from '../../src/core/security/hash';

let n = 0;
beforeEach(() => {
  setDbForTests(new FolioDB(`folio-test-${n++}`));
  resetLeaseForTests('owner');
});
afterEach(async () => {
  await getDb().delete();
  setDbForTests(null);
});

async function input(text = 'hello') {
  const bytes = new TextEncoder().encode('%PDF-1.7 ' + text);
  return {
    title: 'Book ' + text,
    author: 'A',
    hash: await sha256Hex(bytes),
    pageCount: 3,
    fileName: text + '.pdf',
    encrypted: false,
    file: new Blob([bytes], { type: 'application/pdf' }),
    mime: 'application/pdf',
    cover: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
  };
}

describe('IndexedDB Blob persistence (spike)', () => {
  it('stores and reads back original bytes exactly', async () => {
    const inp = await input('blob');
    const book = await LibraryRepository.addBook(inp);
    const file = await LibraryRepository.getFile(book.id);
    expect(file).toBeDefined();
    const back = new Uint8Array(await file!.blob.arrayBuffer());
    expect(await sha256Hex(back)).toBe(inp.hash);
    expect(file!.size).toBe(inp.file.size);
    const cover = await LibraryRepository.getCover(book.coverId!);
    expect(cover?.blob.size).toBe(3);
  });
});

describe('LibraryRepository', () => {
  it('rejects duplicate hashes without creating a second record', async () => {
    await LibraryRepository.addBook(await input('dup'));
    await expect(LibraryRepository.addBook(await input('dup'))).rejects.toMatchObject({ code: 'duplicate' });
    expect(await getDb().books.count()).toBe(1);
    expect(await getDb().bookFiles.count()).toBe(1);
  });

  it('rolls back the whole import if any write fails (no partial book)', async () => {
    const spy = vi.spyOn(getDb().covers, 'add').mockImplementation(() => {
      throw Object.assign(new Error('disk full'), { name: 'QuotaExceededError' });
    });
    await expect(LibraryRepository.addBook(await input('fail'))).rejects.toMatchObject({ code: 'quota' });
    spy.mockRestore();
    expect(await getDb().books.count()).toBe(0);
    expect(await getDb().bookFiles.count()).toBe(0);
    expect(await getDb().covers.count()).toBe(0);
    expect(pendingWrites()).toBe(0);
  });

  it('renames and validates metadata', async () => {
    const b = await LibraryRepository.addBook(await input('meta'));
    await LibraryRepository.update(b.id, { title: '  New title ', author: ' Someone ' });
    const got = await LibraryRepository.get(b.id);
    expect(got?.title).toBe('New title');
    expect(got?.author).toBe('Someone');
    await expect(LibraryRepository.update(b.id, { title: '   ' })).rejects.toBeInstanceOf(StorageError);
  });

  it('deletes a book with all associated data atomically, or detaches notebooks', async () => {
    const db = getDb();
    const a = await LibraryRepository.addBook(await input('del-a'));
    const b = await LibraryRepository.addBook(await input('del-b'));
    for (const book of [a, b]) {
      await db.annotations.add({ id: 'ann-' + book.id, bookId: book.id, pageIndex: 0, type: 'ink', points: [], outline: [], style: { tool: 'pen', color: '#000000', width: 1, opacity: 1 }, createdAt: 0, updatedAt: 0 });
      await db.bookmarks.add({ id: 'bm-' + book.id, bookId: book.id, location: { kind: 'pdf', pageIndex: 1, xFraction: 0, yFraction: 0 }, label: 'x', createdAt: 0, updatedAt: 0 });
      await db.notebooks.add({ id: 'nb-' + book.id, title: 'n', linkedBookId: book.id, template: 'ruled', createdAt: 0, updatedAt: 0 });
      await db.notebookPages.add({ id: 'np-' + book.id, notebookId: 'nb-' + book.id, order: 0, width: 595, height: 842, template: 'ruled', strokes: [], textBlocks: [], link: { bookId: book.id, pageIndex: 0 }, createdAt: 0, updatedAt: 0 });
    }
    const linked = await LibraryRepository.linkedContent(a.id);
    expect(linked).toEqual({ annotations: 1, bookmarks: 1, notebooks: 1, linkedPages: 1 });

    await LibraryRepository.deleteBook(a.id, 'delete-associated');
    expect(await db.books.get(a.id)).toBeUndefined();
    expect(await db.bookFiles.get(a.id)).toBeUndefined();
    expect(await db.annotations.where('bookId').equals(a.id).count()).toBe(0);
    expect(await db.notebooks.get('nb-' + a.id)).toBeUndefined();
    expect(await db.notebookPages.get('np-' + a.id)).toBeUndefined();

    await LibraryRepository.deleteBook(b.id, 'detach-notebooks');
    const nb = await db.notebooks.get('nb-' + b.id);
    expect(nb?.linkedBookId).toBeNull();
    // page link retained so the UI can show an explicit missing link
    expect((await db.notebookPages.get('np-' + b.id))?.link?.bookId).toBe(b.id);
  });

  it('manages collections and memberships', async () => {
    const b = await LibraryRepository.addBook(await input('col'));
    const c = await LibraryRepository.createCollection('Physics');
    await expect(LibraryRepository.createCollection('physics')).rejects.toMatchObject({ code: 'duplicate' });
    await LibraryRepository.setMembership(c.id, b.id, true);
    expect(await LibraryRepository.listMemberships()).toHaveLength(1);
    await LibraryRepository.deleteCollection(c.id);
    expect(await LibraryRepository.listMemberships()).toHaveLength(0);
  });
});

describe('single-writer lease', () => {
  it('blocks writes in a read-only tab', async () => {
    resetLeaseForTests('read-only');
    await expect(LibraryRepository.addBook(await input('ro'))).rejects.toBeInstanceOf(ReadOnlyError);
    expect(await getDb().books.count()).toBe(0);
  });

  it('acquires via Web Locks and falls back to read-only when held elsewhere', async () => {
    resetLeaseForTests('pending');
    let held = false;
    const waiters: (() => void)[] = [];
    const locks = {
      request: (_n: string, opts: { ifAvailable?: boolean }, cb: (l: unknown) => unknown) => {
        if (opts.ifAvailable) {
          if (held) return Promise.resolve(cb(null));
          held = true;
          return Promise.resolve(cb({}));
        }
        return new Promise((r) => waiters.push(() => r(cb({}))));
      },
    };
    acquireLease(locks);
    await Promise.resolve();
    expect(getLeaseState()).toBe('owner');
    resetLeaseForTests('pending');
    acquireLease(locks);
    await Promise.resolve();
    expect(getLeaseState()).toBe('read-only');
    waiters[0]!();
    await Promise.resolve();
    expect(getLeaseState()).toBe('owner');
  });

  it('is read-only when Web Locks are unavailable (no unproven fallback)', () => {
    resetLeaseForTests('pending');
    acquireLease(undefined);
    expect(getLeaseState()).toBe('unsupported');
  });
});

describe('ProgressRepository', () => {
  it('saves location and counts qualified pages once', async () => {
    await ProgressRepository.saveLocation('b1', { kind: 'pdf', pageIndex: 4, xFraction: 0, yFraction: 0.25 });
    await ProgressRepository.addQualifiedPages('b1', [1, 2, 2, 3]);
    await ProgressRepository.addQualifiedPages('b1', [2, 3, 4]);
    const p = await ProgressRepository.get('b1');
    expect(p.lastLocation).toEqual({ kind: 'pdf', pageIndex: 4, xFraction: 0, yFraction: 0.25 });
    expect(p.qualifiedPages).toEqual([1, 2, 3, 4]);
    await ProgressRepository.setCompleted('b1', true);
    expect((await ProgressRepository.get('b1')).completedAt).not.toBeNull();
    await ProgressRepository.resetProgress('b1');
    const r = await ProgressRepository.get('b1');
    expect(r.qualifiedPages).toEqual([]);
    expect(r.completedAt).toBeNull();
    expect(r.lastLocation?.kind).toBe('pdf');
  });
});

describe('error mapping', () => {
  it('maps quota and unknown errors', () => {
    expect(toStorageError({ name: 'QuotaExceededError' }).code).toBe('quota');
    expect(toStorageError({ inner: { name: 'QuotaExceededError' } }).code).toBe('quota');
    expect(toStorageError(new Error('x')).code).toBe('unknown');
  });
});
