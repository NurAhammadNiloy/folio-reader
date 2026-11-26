import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  AnnotationRecord,
  BookFileRecord,
  BookmarkRecord,
  BookRecord,
  CollectionRecord,
  CoverRecord,
  InkCheckpointRecord,
  MembershipRecord,
  MetadataRecord,
  NotebookPageRecord,
  NotebookRecord,
  ReadingProgressRecord,
  ReadingSessionRecord,
  SettingRecord,
} from './types';

export const DB_NAME = 'folio';
export const SCHEMA_VERSION = 1;

export class FolioDB extends Dexie {
  books!: EntityTable<BookRecord, 'id'>;
  bookFiles!: EntityTable<BookFileRecord, 'bookId'>;
  covers!: EntityTable<CoverRecord, 'id'>;
  collections!: EntityTable<CollectionRecord, 'id'>;
  memberships!: Table<MembershipRecord, [string, string]>;
  annotations!: EntityTable<AnnotationRecord, 'id'>;
  notebooks!: EntityTable<NotebookRecord, 'id'>;
  notebookPages!: EntityTable<NotebookPageRecord, 'id'>;
  bookmarks!: EntityTable<BookmarkRecord, 'id'>;
  readingProgress!: EntityTable<ReadingProgressRecord, 'bookId'>;
  readingSessions!: EntityTable<ReadingSessionRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;
  metadata!: EntityTable<MetadataRecord, 'key'>;
  inkCheckpoints!: EntityTable<InkCheckpointRecord, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    // Version 1. Future versions must add explicit, tested upgrade functions;
    // never reset the database automatically (spec 12.4).
    this.version(SCHEMA_VERSION).stores({
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
    });
    // Dexie 4 opens a database whose installed version is higher than ours instead of
    // failing. A newer Folio may have changed the meaning of the data, so refuse it.
    this.on('ready', (db) => {
      const installed = (db as Dexie).backendDB().version;
      if (isNewerThanApp(installed)) {
        const err = new Error(`Library schema ${installed / 10} is newer than this app (${SCHEMA_VERSION}).`);
        err.name = 'VersionError';
        throw err;
      }
    });
    this.on('populate', (tx) => {
      void tx.table('metadata').add({ key: 'schemaVersion', value: SCHEMA_VERSION });
      void tx.table('metadata').add({ key: 'createdAt', value: Date.now() });
    });
  }
}

/**
 * Read the installed IndexedDB version without creating or upgrading anything.
 * Returns 0 when no library exists yet. Used before Dexie opens, because Dexie
 * would otherwise adjust a newer database to fit this schema.
 */
export function installedVersion(name = DB_NAME): Promise<number> {
  return new Promise((resolve) => {
    let created = false;
    const q = indexedDB.open(name);
    q.onupgradeneeded = () => {
      created = true; // nothing exists: abort so no empty database is left behind
      q.transaction?.abort();
    };
    q.onsuccess = () => {
      const v = q.result.version;
      q.result.close();
      resolve(v);
    };
    q.onerror = () => resolve(created ? 0 : -1);
  });
}

export function isNewerThanApp(nativeVersion: number) {
  return nativeVersion > SCHEMA_VERSION * 10;
}

let instance: FolioDB | null = null;

export function getDb(): FolioDB {
  if (!instance) instance = new FolioDB();
  return instance;
}

/** Test hook: replace the singleton (e.g. with a fresh fake-indexeddb database). */
export function setDbForTests(db: FolioDB | null): void {
  instance = db;
}

export const ALL_TABLES = [
  'books',
  'bookFiles',
  'covers',
  'collections',
  'memberships',
  'annotations',
  'notebooks',
  'notebookPages',
  'bookmarks',
  'readingProgress',
  'readingSessions',
  'settings',
  'metadata',
  'inkCheckpoints',
] as const;
