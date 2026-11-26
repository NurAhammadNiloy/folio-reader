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
    this.on('populate', (tx) => {
      void tx.table('metadata').add({ key: 'schemaVersion', value: SCHEMA_VERSION });
      void tx.table('metadata').add({ key: 'createdAt', value: Date.now() });
    });
  }
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
