// .folio-backup format (spec 7, 12.4): a ZIP with manifest.json, data.json, original
// PDFs and covers. Restore validates names, counts, actual expanded bytes, per-entry
// SHA-256, a strict schema and cross references before anything touches the database.
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { z } from 'zod';
import { LIMITS } from '../security/limits';
import { sha256Hex } from '../security/hash';
import { SCHEMA_VERSION } from '../storage/db';

export const BACKUP_FORMAT = 'folio-backup';
export const BACKUP_FORMAT_VERSION = 1;

export { BackupError } from './backupError';
import { BackupError } from './backupError';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const num = z.number().finite();
const ts = z.number().int().nonnegative();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const point = z.object({ x: num, y: num, p: num.min(0).max(1) }).strict();
const style = z
  .object({ tool: z.enum(['pen', 'highlighter']), color, width: num.positive().max(200), opacity: num.min(0).max(1) })
  .strict();
const pdfLoc = z.object({ kind: z.literal('pdf'), pageIndex: z.number().int().nonnegative(), xFraction: num.min(0).max(1), yFraction: num.min(0).max(1) }).strict();
const epubLoc = z.object({ kind: z.literal('epub'), spineIndex: z.number().int().nonnegative().max(LIMITS.maxPdfPages), fraction: num.min(0).max(1) }).strict();
const location = z.discriminatedUnion('kind', [pdfLoc, epubLoc]);
const outline = z.array(z.tuple([num, num])).max(200_000);

export const bookSchema = z
  .object({
    id: uuid,
    format: z.enum(['pdf', 'epub']),
    title: z.string().min(1).max(1000),
    author: z.string().max(1000),
    hash: hex64,
    coverId: uuid.nullable(),
    pageCount: z.number().int().positive().max(LIMITS.maxPdfPages),
    direction: z.enum(['ltr', 'rtl']),
    fileName: z.string().max(500),
    fileSize: z.number().int().positive(),
    encrypted: z.boolean(),
    favourite: z.boolean(),
    createdAt: ts,
    updatedAt: ts,
    lastOpenedAt: ts.nullable(),
  })
  .strict();

const dataSchema = z
  .object({
    books: z.array(bookSchema).max(5000),
    collections: z.array(z.object({ id: uuid, title: z.string().min(1).max(200), createdAt: ts }).strict()).max(5000),
    memberships: z.array(z.object({ collectionId: uuid, bookId: uuid, addedAt: ts }).strict()).max(100_000),
    annotations: z
      .array(
        z
          .object({
            id: uuid,
            bookId: uuid,
            pageIndex: z.number().int().nonnegative(),
            type: z.literal('ink'),
            points: z.array(point).max(100_000),
            outline,
            style,
            createdAt: ts,
            updatedAt: ts,
          })
          .strict(),
      )
      .max(500_000),
    notebooks: z
      .array(
        z
          .object({ id: uuid, title: z.string().max(500), linkedBookId: uuid.nullable(), template: z.enum(['blank', 'ruled', 'grid', 'dotted']), createdAt: ts, updatedAt: ts })
          .strict(),
      )
      .max(10_000),
    notebookPages: z
      .array(
        z
          .object({
            id: uuid,
            notebookId: uuid,
            order: z.number().int().nonnegative(),
            width: num.positive().max(10000),
            height: num.positive().max(10000),
            template: z.enum(['blank', 'ruled', 'grid', 'dotted']),
            strokes: z.array(z.object({ id: uuid, points: z.array(point).max(100_000), outline, style, createdAt: ts }).strict()).max(20_000),
            textBlocks: z
              .array(z.object({ id: uuid, x: num, y: num, width: num.positive(), text: z.string().max(100_000), fontSize: num.positive().max(200) }).strict())
              .max(2000),
            link: z.object({ bookId: uuid, pageIndex: z.number().int().nonnegative() }).strict().nullable(),
            createdAt: ts,
            updatedAt: ts,
          })
          .strict(),
      )
      .max(100_000),
    bookmarks: z.array(z.object({ id: uuid, bookId: uuid, location, label: z.string().max(500), createdAt: ts, updatedAt: ts }).strict()).max(100_000),
    readingProgress: z
      .array(
        z
          .object({
            bookId: uuid,
            lastLocation: location.nullable(),
            qualifiedPages: z.array(z.number().int().nonnegative()).max(LIMITS.maxPdfPages),
            completedAt: ts.nullable(),
            viewerPrefs: z
              .object({
                viewMode: z.enum(['single', 'scroll', 'spread']),
                zoomMode: z.enum(['fitWidth', 'fitPage', 'custom']),
                zoom: num.min(LIMITS.zoomMin).max(LIMITS.zoomMax),
                rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
                coverAlone: z.boolean(),
              })
              .strict()
              .nullable(),
            updatedAt: ts,
          })
          .strict(),
      )
      .max(5000),
    readingSessions: z
      .array(z.object({ id: uuid, bookId: uuid, startedAt: ts, activeMs: z.number().int().nonnegative(), localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timeZone: z.string().max(100), updatedAt: ts }).strict())
      .max(500_000),
    settings: z.array(z.object({ key: z.string().max(100), value: z.unknown() }).strict()).max(200),
    covers: z.array(z.object({ id: uuid, bookId: uuid, path: z.string(), type: z.string().max(50) }).strict()).max(5000),
  })
  .strict();

export type BackupData = z.infer<typeof dataSchema>;

const manifestSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.number().int(),
    schemaVersion: z.number().int(),
    createdAt: ts,
    scope: z.enum(['library', 'book']),
    entries: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative(), sha256: hex64 }).strict()).max(LIMITS.backupMaxEntries),
  })
  .strict();

export type BackupManifest = z.infer<typeof manifestSchema>;

export interface BackupBundle {
  manifest: BackupManifest;
  data: BackupData;
  files: Map<string, Uint8Array>; // bookId -> PDF bytes
  covers: Map<string, { bytes: Uint8Array; type: string }>; // coverId -> image
  expandedBytes: number;
}

const ENTRY_RE = /^(manifest\.json|data\.json|files\/[0-9a-f-]{36}\.(pdf|epub)|covers\/[0-9a-f-]{36}\.(webp|png|jpg))$/i;

export function bookFilePath(bookId: string, format: 'pdf' | 'epub') {
  return `files/${bookId}.${format}`;
}

export function isSafeEntryName(name: string): boolean {
  if (name.length > 200) return false;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is intended
  if (name.includes('\\') || name.startsWith('/') || name.includes('..') || /[\u0000-\u001f]/.test(name)) return false;
  return ENTRY_RE.test(name);
}

export interface ExportInput {
  scope: 'library' | 'book';
  data: Omit<BackupData, 'covers'>;
  files: Map<string, Blob>; // bookId -> original
  covers: Map<string, { bookId: string; blob: Blob }>; // coverId -> cover
}

function coverExt(type: string) {
  return type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';
}

/** Build a backup archive. Throws if it would exceed the configured caps. */
export async function buildBackup(input: ExportInput, now = Date.now()): Promise<Uint8Array> {
  const zippable: Zippable = {};
  const entries: BackupManifest['entries'] = [];
  let expanded = 0;
  const add = async (path: string, bytes: Uint8Array, compress: boolean) => {
    expanded += bytes.length;
    if (expanded > LIMITS.backupMaxExpandedBytes)
      throw new BackupError('too-large', 'This backup would be larger than 250 MB. Export individual books instead (book menu → Export book backup).');
    entries.push({ path, size: bytes.length, sha256: await sha256Hex(bytes) });
    zippable[path] = [bytes, { level: compress ? 6 : 0 }];
  };
  const formatOf = new Map(input.data.books.map((b) => [b.id, b.format]));
  for (const [bookId, blob] of input.files) await add(bookFilePath(bookId, formatOf.get(bookId) ?? 'pdf'), new Uint8Array(await blob.arrayBuffer()), false);
  const coverList: BackupData['covers'] = [];
  for (const [coverId, c] of input.covers) {
    const path = `covers/${coverId}.${coverExt(c.blob.type)}`;
    await add(path, new Uint8Array(await c.blob.arrayBuffer()), false);
    coverList.push({ id: coverId, bookId: c.bookId, path, type: c.blob.type || 'image/webp' });
  }
  const data: BackupData = { ...input.data, covers: coverList };
  await add('data.json', strToU8(JSON.stringify(data)), true);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    scope: input.scope,
    entries,
  };
  zippable['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  const out = zipSync(zippable, { mtime: new Date(now) });
  if (out.length > LIMITS.backupMaxCompressedBytes)
    throw new BackupError('too-large', 'This backup would be larger than 150 MB. Export individual books instead.');
  return out;
}

/** Bounded streaming extraction with actual byte counters. */
function extract(zip: Uint8Array): { entries: Map<string, Uint8Array>; expanded: number } {
  const entries = new Map<string, Uint8Array>();
  let expanded = 0;
  let count = 0;
  let failure: BackupError | null = null;
  const fail = (e: BackupError) => {
    if (!failure) failure = e;
  };
  const un = new Unzip((file) => {
    if (failure) return;
    count++;
    if (count > LIMITS.backupMaxEntries) return fail(new BackupError('unsafe', 'The backup contains too many files.'));
    if (!isSafeEntryName(file.name)) return fail(new BackupError('unsafe', `The backup contains an unexpected file (“${file.name.slice(0, 80)}”).`));
    if (entries.has(file.name)) return fail(new BackupError('unsafe', `The backup contains a duplicate entry (“${file.name}”).`));
    if (file.originalSize !== undefined && file.originalSize > LIMITS.backupMaxExpandedBytes)
      return fail(new BackupError('too-large', 'The backup expands beyond the 250 MB limit.'));
    const chunks: Uint8Array[] = [];
    let size = 0;
    entries.set(file.name, new Uint8Array());
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) return fail(new BackupError('corrupt', 'The backup archive is damaged.'));
      size += chunk.length;
      expanded += chunk.length;
      if (expanded > LIMITS.backupMaxExpandedBytes) {
        file.terminate();
        return fail(new BackupError('too-large', 'The backup expands beyond the 250 MB limit.'));
      }
      chunks.push(chunk);
      if (final) {
        const all = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          all.set(c, o);
          o += c.length;
        }
        entries.set(file.name, all);
      }
    };
    file.start();
  });
  un.register(UnzipInflate);
  un.register(UnzipPassThrough);
  const CHUNK = 1 << 20;
  try {
    for (let i = 0; i < zip.length && !failure; i += CHUNK) un.push(zip.subarray(i, i + CHUNK), i + CHUNK >= zip.length);
  } catch {
    fail(new BackupError('corrupt', 'The backup archive is damaged or is not a Folio backup.'));
  }
  if (failure) throw failure;
  return { entries, expanded };
}

/** Parse and fully validate a backup. Nothing is written. */
export async function parseBackup(zip: Uint8Array): Promise<BackupBundle> {
  if (zip.length > LIMITS.backupMaxCompressedBytes) throw new BackupError('too-large', 'Backups larger than 150 MB cannot be restored.');
  if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) throw new BackupError('not-backup', 'This file is not a Folio backup.');
  const { entries, expanded } = extract(zip);
  const mRaw = entries.get('manifest.json');
  const dRaw = entries.get('data.json');
  if (!mRaw || !dRaw) throw new BackupError('not-backup', 'This file is not a Folio backup (manifest missing).');
  let manifest: BackupManifest;
  try {
    manifest = manifestSchema.parse(JSON.parse(strFromU8(mRaw)));
  } catch {
    throw new BackupError('invalid', 'The backup manifest is not valid.');
  }
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION || manifest.schemaVersion > SCHEMA_VERSION)
    throw new BackupError('version', 'This backup was made by a newer version of Folio. Update Folio, then try again.');
  // Every archive entry except the manifest is listed exactly once with matching size and hash.
  const listed = new Map(manifest.entries.map((e) => [e.path, e]));
  if (listed.size !== manifest.entries.length) throw new BackupError('invalid', 'The backup manifest lists a file twice.');
  for (const name of entries.keys()) if (name !== 'manifest.json' && !listed.has(name)) throw new BackupError('invalid', `“${name}” is not listed in the manifest.`);
  for (const e of manifest.entries) {
    const bytes = entries.get(e.path);
    if (!bytes) throw new BackupError('corrupt', `The backup is missing “${e.path}”.`);
    if (bytes.length !== e.size || (await sha256Hex(bytes)) !== e.sha256) throw new BackupError('corrupt', `“${e.path}” is damaged (checksum mismatch).`);
  }
  let data: BackupData;
  try {
    data = dataSchema.parse(JSON.parse(strFromU8(dRaw)));
  } catch {
    throw new BackupError('invalid', 'The backup data is not valid.');
  }
  const files = new Map<string, Uint8Array>();
  const books = new Map(data.books.map((b) => [b.id, b]));
  if (books.size !== data.books.length) throw new BackupError('invalid', 'The backup contains duplicate books.');
  if (new Set(data.books.map((b) => b.hash)).size !== data.books.length) throw new BackupError('invalid', 'The backup contains the same book twice.');
  for (const b of data.books) {
    const bytes = entries.get(bookFilePath(b.id, b.format));
    if (!bytes) throw new BackupError('corrupt', `The original file for “${b.title}” is missing from the backup.`);
    if ((await sha256Hex(bytes)) !== b.hash) throw new BackupError('corrupt', `The original file for “${b.title}” does not match its checksum.`);
    files.set(b.id, bytes);
  }
  const covers = new Map<string, { bytes: Uint8Array; type: string }>();
  for (const c of data.covers) {
    const bytes = entries.get(c.path);
    if (!bytes || !books.has(c.bookId) || books.get(c.bookId)!.coverId !== c.id) throw new BackupError('invalid', 'A cover in the backup is inconsistent.');
    covers.set(c.id, { bytes, type: /^image\/(webp|png|jpeg)$/.test(c.type) ? c.type : 'image/webp' });
  }
  for (const b of data.books) if (b.coverId && !covers.has(b.coverId)) throw new BackupError('invalid', `The cover for “${b.title}” is missing.`);
  const needBook = (bookId: string, what: string) => {
    if (!books.has(bookId)) throw new BackupError('invalid', `The backup has ${what} for a book it does not contain.`);
    return books.get(bookId)!;
  };
  const collections = new Set(data.collections.map((c) => c.id));
  for (const m of data.memberships) {
    needBook(m.bookId, 'a collection entry');
    if (!collections.has(m.collectionId)) throw new BackupError('invalid', 'The backup has a collection entry for a missing collection.');
  }
  for (const a of data.annotations) {
    const b = needBook(a.bookId, 'marks');
    if (a.pageIndex >= b.pageCount) throw new BackupError('invalid', 'The backup has a mark on a page that does not exist.');
  }
  for (const bm of data.bookmarks) needBook(bm.bookId, 'a bookmark');
  for (const p of data.readingProgress) needBook(p.bookId, 'reading progress');
  for (const s of data.readingSessions) needBook(s.bookId, 'reading history');
  const notebooks = new Set(data.notebooks.map((n) => n.id));
  for (const n of data.notebooks) if (n.linkedBookId && !books.has(n.linkedBookId) && manifest.scope === 'library') n.linkedBookId = null;
  for (const p of data.notebookPages) if (!notebooks.has(p.notebookId)) throw new BackupError('invalid', 'The backup has a notebook page without its notebook.');
  const allIds = [
    ...data.annotations.map((x) => x.id),
    ...data.notebooks.map((x) => x.id),
    ...data.notebookPages.map((x) => x.id),
    ...data.bookmarks.map((x) => x.id),
    ...data.readingSessions.map((x) => x.id),
    ...data.collections.map((x) => x.id),
  ];
  if (new Set(allIds).size !== allIds.length) throw new BackupError('invalid', 'The backup contains duplicate record IDs.');
  return { manifest, data, files, covers, expandedBytes: expanded };
}
