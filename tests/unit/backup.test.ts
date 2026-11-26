import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { FolioDB, setDbForTests, getDb } from '../../src/core/storage/db';
import { resetLeaseForTests } from '../../src/core/storage/lease';
import { LibraryRepository } from '../../src/core/storage/libraryRepository';
import { BackupRepository } from '../../src/core/storage/backupRepository';
import { NotebookRepository } from '../../src/core/storage/notebookRepository';
import { BookmarkRepository } from '../../src/core/storage/bookmarkRepository';
import { ProgressRepository } from '../../src/core/storage/progressRepository';
import { buildBackup, parseBackup, isSafeEntryName } from '../../src/core/export/backupFormat';
import { sha256Hex } from '../../src/core/security/hash';
import { fixture } from './helpers';
import { storedBlob } from '../../src/core/storage/types';
import { SettingsRepository } from '../../src/core/storage/settingsRepository';

let n = 0;
beforeEach(() => {
  setDbForTests(new FolioDB(`folio-backup-${n++}`));
  resetLeaseForTests('owner');
});
afterEach(async () => {
  await getDb().delete();
  setDbForTests(null);
});

async function seed() {
  const bytes = fixture('single.pdf');
  const hash = await sha256Hex(bytes);
  const book = await LibraryRepository.addBook({
    title: 'Ink Fixture', author: 'Test', hash, pageCount: 1, fileName: 'single.pdf', encrypted: false,
    file: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), mime: 'application/pdf',
    cover: new Blob([new Uint8Array([9, 9, 9])], { type: 'image/webp' }),
  });
  await getDb().annotations.add({
    id: crypto.randomUUID(), bookId: book.id, pageIndex: 0, type: 'ink',
    points: [{ x: 10, y: 20, p: 0.5 }, { x: 30, y: 40, p: 0.7 }], outline: [[10, 20], [30, 40], [20, 30]],
    style: { tool: 'pen', color: '#112233', width: 2, opacity: 1 }, createdAt: 1, updatedAt: 1,
  });
  const bm = await BookmarkRepository.add(book.id, { kind: 'pdf', pageIndex: 0, xFraction: 0, yFraction: 0.5 }, 'Start');
  const nb = await NotebookRepository.create('Notes', book.id);
  const [page] = await NotebookRepository.pages(nb.id);
  await NotebookRepository.savePage({ ...page!, textBlocks: [{ id: crypto.randomUUID(), x: 10, y: 10, width: 200, text: 'বাংলা নোট — مرحبا', fontSize: 14 }] });
  await ProgressRepository.saveLocation(book.id, { kind: 'pdf', pageIndex: 0, xFraction: 0, yFraction: 0.42 });
  return { book, hash, bm, nb };
}

describe('backup roundtrip', () => {
  it('exports and restores into an empty library with identical data (integrity gate)', async () => {
    const { book, hash, bm, nb } = await seed();
    const before = await BackupRepository.collect({ kind: 'library' });
    const zip = await buildBackup(before);
    const bundle = await parseBackup(zip);

    // Fresh "profile"
    await getDb().delete();
    setDbForTests(new FolioDB(`folio-backup-fresh-${n++}`));
    const plan = await BackupRepository.plan(bundle);
    expect(plan.mode).toBe('empty');
    await BackupRepository.commit(bundle, 'empty');

    const restored = await LibraryRepository.get(book.id);
    expect(restored?.hash).toBe(hash);
    const file = await LibraryRepository.getFile(book.id);
    expect(file!.blob).toBeInstanceOf(ArrayBuffer); // WebKit-safe storage
    expect(await sha256Hex(new Uint8Array(await storedBlob(file!.blob, file!.mime).arrayBuffer()))).toBe(hash);
    const anns = await getDb().annotations.toArray();
    expect(anns.map((a) => a.id)).toEqual(before.data.annotations.map((a) => a.id));
    expect(anns[0]!.points).toEqual(before.data.annotations[0]!.points);
    expect((await getDb().bookmarks.get(bm.id))?.label).toBe('Start');
    const pages = await NotebookRepository.pages(nb.id);
    expect(pages[0]!.textBlocks[0]!.text).toBe('বাংলা নোট — مرحبا');
    expect((await ProgressRepository.get(book.id)).lastLocation).toEqual({ kind: 'pdf', pageIndex: 0, xFraction: 0, yFraction: 0.42 });
    expect((await getDb().covers.toArray()).length).toBe(1);
  });

  it('refuses to append conflicting data and leaves the library untouched', async () => {
    await seed();
    const zip = await buildBackup(await BackupRepository.collect({ kind: 'library' }));
    const bundle = await parseBackup(zip);
    const plan = await BackupRepository.plan(bundle);
    expect(plan.conflicts.length).toBeGreaterThan(0);
    await expect(BackupRepository.commit(bundle, 'append')).rejects.toMatchObject({ code: 'conflict' });
    expect(await getDb().books.count()).toBe(1);
  });

  it('keeps the existing library if a replace fails mid-transaction (simulated quota)', async () => {
    const { book } = await seed();
    const zip = await buildBackup(await BackupRepository.collect({ kind: 'library' }));
    const bundle = await parseBackup(zip);
    const spy = vi.spyOn(getDb().annotations, 'bulkAdd').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    await expect(BackupRepository.commit(bundle, 'replace')).rejects.toMatchObject({ code: 'quota' });
    spy.mockRestore();
    // replace cleared tables inside the aborted transaction: everything must still be there
    expect(await LibraryRepository.get(book.id)).toBeDefined();
    expect(await getDb().annotations.count()).toBe(1);
    expect(await getDb().notebooks.count()).toBe(1);
  });

  it('appends a non-conflicting single-book package atomically', async () => {
    const { book } = await seed();
    const pkg = await buildBackup(await BackupRepository.collect({ kind: 'book', bookId: book.id }));
    const bundle = await parseBackup(pkg);
    await getDb().delete();
    setDbForTests(new FolioDB(`folio-backup-other-${n++}`));
    // a different existing book
    const other = fixture('text-12p.pdf');
    await LibraryRepository.addBook({ title: 'Other', author: '', hash: await sha256Hex(other), pageCount: 12, fileName: 'o.pdf', encrypted: false, file: new Blob([other as Uint8Array<ArrayBuffer>]), mime: 'application/pdf', cover: null });
    const plan = await BackupRepository.plan(bundle);
    expect(plan.mode).toBe('append');
    expect(plan.conflicts).toEqual([]);
    await BackupRepository.commit(bundle, 'append');
    expect(await getDb().books.count()).toBe(2);
  });
});

describe('hostile backups are rejected before any write', () => {
  const manifest = (entries: object[]) => strToU8(JSON.stringify({ format: 'folio-backup', formatVersion: 1, schemaVersion: 1, createdAt: 1, scope: 'library', entries }));

  it('rejects path traversal and unexpected names', async () => {
    expect(isSafeEntryName('../evil.pdf')).toBe(false);
    expect(isSafeEntryName('files/../../x')).toBe(false);
    expect(isSafeEntryName('/abs')).toBe(false);
    expect(isSafeEntryName('files\\x.pdf')).toBe(false);
    const zip = zipSync({ 'manifest.json': manifest([]), '../evil.txt': strToU8('x') });
    await expect(parseBackup(zip)).rejects.toMatchObject({ code: 'unsafe' });
  });

  it('rejects non-zip and corrupted archives', async () => {
    await expect(parseBackup(strToU8('hello'))).rejects.toMatchObject({ code: 'not-backup' });
    const zip = await buildBackup(await (async () => {
      await seed();
      return BackupRepository.collect({ kind: 'library' });
    })());
    const broken = zip.slice(0, Math.floor(zip.length * 0.6));
    await expect(parseBackup(broken)).rejects.toBeTruthy();
  });

  it('rejects checksum mismatches', async () => {
    const data = strToU8('{}');
    const zip = zipSync({ 'manifest.json': manifest([{ path: 'data.json', size: data.length, sha256: '0'.repeat(64) }]), 'data.json': data });
    await expect(parseBackup(zip)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('stops extraction when actual expanded bytes exceed the cap (zip bomb)', async () => {
    const big = new Uint8Array(260 * 1024 * 1024); // zeros compress extremely well
    const zip = zipSync({ 'manifest.json': manifest([]), 'data.json': [big, { level: 9 }] });
    expect(zip.length).toBeLessThan(2 * 1024 * 1024);
    await expect(parseBackup(zip)).rejects.toMatchObject({ code: 'too-large' });
  }, 60_000);

  it('rejects schema violations and dangling references', async () => {
    const bad = strToU8(JSON.stringify({ books: [{ id: 'x' }] }));
    const zip = zipSync({ 'manifest.json': manifest([{ path: 'data.json', size: bad.length, sha256: await sha256Hex(bad) }]), 'data.json': bad });
    await expect(parseBackup(zip)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects backups from a newer format', async () => {
    const m = strToU8(JSON.stringify({ format: 'folio-backup', formatVersion: 99, schemaVersion: 1, createdAt: 1, scope: 'library', entries: [] }));
    const zip = zipSync({ 'manifest.json': m, 'data.json': strToU8('{}') });
    await expect(parseBackup(zip)).rejects.toMatchObject({ code: 'version' });
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test edits arbitrary JSON paths
type Tampered = any;

describe('backup contents are checked for meaning, not only shape', () => {
  /** Take a real backup, edit data.json, and re-sign it so only the edit is wrong. */
  async function tampered(edit: (d: Tampered) => void) {
    await seed();
    const files = unzipSync(await buildBackup(await BackupRepository.collect({ kind: 'library' })));
    const data = JSON.parse(strFromU8(files['data.json']!));
    edit(data);
    files['data.json'] = strToU8(JSON.stringify(data));
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    for (const e of m.entries) {
      e.size = files[e.path]!.length;
      e.sha256 = await sha256Hex(files[e.path]!);
    }
    files['manifest.json'] = strToU8(JSON.stringify(m));
    return zipSync(files);
  }

  it('rejects positions, bookmarks, progress and notebook links past the last page', async () => {
    const cases: ((d: Tampered) => void)[] = [
      (d) => (d.readingProgress[0].lastLocation.pageIndex = 99_999),
      (d) => (d.readingProgress[0].qualifiedPages = [0, 5]),
      (d) => (d.readingProgress[0].qualifiedPages = [0, 0]),
      (d) => (d.bookmarks[0].location.pageIndex = 3),
      (d) => (d.bookmarks[0].location = { kind: 'epub', spineIndex: 0, fraction: 0 }),
      (d) => (d.notebookPages[0].link = { bookId: d.books[0].id, pageIndex: 7 }),
    ];
    for (const c of cases) {
      await expect(parseBackup(await tampered(c))).rejects.toMatchObject({ code: 'invalid' });
      await getDb().delete();
      setDbForTests(new FolioDB(`folio-backup-${n++}`));
    }
  });

  it('drops unknown settings and bad values instead of restoring them', async () => {
    const zip = await tampered((d) => {
      d.settings = [
        { key: 'theme', value: { evil: 1 } },
        { key: 'qualifySeconds', value: -5 },
        { key: 'idleSeconds', value: 'abc' },
        { key: '__proto__', value: { polluted: true } },
        { key: 'toString', value: 'x' },
        { key: 'fingerInDrawMode', value: 'draw' },
      ];
    });
    const bundle = await parseBackup(zip);
    expect(bundle.data.settings).toEqual([{ key: 'fingerInDrawMode', value: 'draw' }]);
  });

  it('ignores invalid settings already stored on the device', async () => {
    await getDb().settings.bulkPut([
      { key: 'theme', value: 'x'.repeat(1000) },
      { key: 'qualifySeconds', value: 10 },
      { key: 'constructor', value: 1 },
    ]);
    const s = await SettingsRepository.getAll();
    expect(s.theme).toBe('system');
    expect(s.qualifySeconds).toBe(10);
    expect(Object.hasOwn(s, 'constructor')).toBe(false);
  });

  it('clears notebook links to books a full backup does not contain', async () => {
    const ghost = crypto.randomUUID();
    const bundle = await parseBackup(await tampered((d) => (d.notebookPages[0].link = { bookId: ghost, pageIndex: 0 })));
    expect(bundle.data.notebookPages[0]!.link).toBeNull();
  });
});
