// Durable record types. Section 7 + 12.4 of docs/PRODUCT_SPEC.md are authoritative.
// All timestamps are UTC epoch milliseconds. PDF page indexes are zero-based.

export type BookFormat = 'pdf' | 'epub';
export type ReadingDirection = 'ltr' | 'rtl';

export interface PdfLocation {
  kind: 'pdf';
  pageIndex: number;
  /** Horizontal scroll position within the page, 0..1. */
  xFraction: number;
  /** Vertical position within the page, 0..1. */
  yFraction: number;
}
/** Reflowable position: spine (chapter) index plus progress through it, 0..1. */
export interface EpubLocation {
  kind: 'epub';
  spineIndex: number;
  fraction: number;
}
export type BookLocation = PdfLocation | EpubLocation;

export interface BookRecord {
  id: string;
  format: BookFormat;
  title: string;
  author: string;
  /** SHA-256 of the exact original bytes, lowercase hex. */
  hash: string;
  coverId: string | null;
  pageCount: number;
  direction: ReadingDirection;
  fileName: string;
  fileSize: number;
  encrypted: boolean;
  favourite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

/**
 * Binary payloads are stored as ArrayBuffer. WebKit cannot store Blobs in IndexedDB in
 * private or ephemeral sessions ("Could not save"), while ArrayBuffers work everywhere.
 * Older records may still hold a Blob; read through `storedBlob()`.
 */
export type StoredBinary = Blob | ArrayBuffer;

/** Wrap a stored payload as a Blob of the given type. */
export function storedBlob(v: StoredBinary, type: string): Blob {
  return v instanceof Blob ? v : new Blob([v], { type });
}

export interface BookFileRecord {
  bookId: string;
  blob: StoredBinary;
  mime: string;
  size: number;
  checksum: string;
}

export interface CoverRecord {
  id: string;
  bookId: string;
  blob: StoredBinary;
  /** MIME type of the cover image (missing on old records: image/webp). */
  type?: string;
}

export interface CollectionRecord {
  id: string;
  title: string;
  createdAt: number;
}

export interface MembershipRecord {
  collectionId: string;
  bookId: string;
  addedAt: number;
}

export type ViewMode = 'single' | 'scroll' | 'spread';
export type ZoomMode = 'fitWidth' | 'fitPage' | 'custom';

export interface ViewerPrefs {
  viewMode: ViewMode;
  zoomMode: ZoomMode;
  /** Custom zoom factor, 0.25..4 (relative to 72 dpi CSS pixels). */
  zoom: number;
  /** Extra view rotation in degrees applied on top of intrinsic page rotation. */
  rotation: 0 | 90 | 180 | 270;
  /** In spread view, show page 1 alone as a cover. */
  coverAlone: boolean;
}

export interface ReadingProgressRecord {
  bookId: string;
  lastLocation: BookLocation | null;
  /** Zero-based page indexes that met the qualification heuristic. */
  qualifiedPages: number[];
  completedAt: number | null;
  viewerPrefs: ViewerPrefs | null;
  updatedAt: number;
}

export interface ReadingSessionRecord {
  id: string;
  bookId: string;
  startedAt: number;
  activeMs: number;
  localDate: string; // YYYY-MM-DD in the recorded timezone
  timeZone: string;
  updatedAt: number;
}

export interface BookmarkRecord {
  id: string;
  bookId: string;
  location: BookLocation;
  label: string;
  createdAt: number;
  updatedAt: number;
}

export type InkTool = 'pen' | 'highlighter';

export interface StrokePoint {
  /** PDF user-space x (canonical, unrotated, crop offsets retained). */
  x: number;
  y: number;
  /** Pressure 0..1; 0.5 when the device did not report pressure. */
  p: number;
}

export interface InkStyle {
  tool: InkTool;
  color: string; // #RRGGBB
  /** Nominal width in PDF user-space units (or notebook units). */
  width: number;
  opacity: number;
}

export interface AnnotationRecord {
  id: string;
  bookId: string;
  pageIndex: number;
  type: 'ink';
  points: StrokePoint[];
  /** Outline polygon in the same canonical space, used for display and export. */
  outline: [number, number][];
  style: InkStyle;
  createdAt: number;
  updatedAt: number;
}

export type NotebookTemplate = 'blank' | 'ruled' | 'grid' | 'dotted';

export interface NotebookRecord {
  id: string;
  title: string;
  linkedBookId: string | null;
  template: NotebookTemplate;
  createdAt: number;
  updatedAt: number;
}

export interface TextBlock {
  id: string;
  /** Position in notebook virtual units (A4 = 595 x 842). */
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
}

export interface NotebookStroke {
  id: string;
  points: StrokePoint[];
  outline: [number, number][];
  style: InkStyle;
  createdAt: number;
}

export interface NotebookPageRecord {
  id: string;
  notebookId: string;
  order: number;
  width: number;
  height: number;
  template: NotebookTemplate;
  strokes: NotebookStroke[];
  textBlocks: TextBlock[];
  /** Optional link to a book page. */
  link: { bookId: string; pageIndex: number } | null;
  createdAt: number;
  updatedAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface MetadataRecord {
  key: string;
  value: unknown;
}

export interface InkCheckpointRecord {
  id: string; // one per target surface
  bookId: string | null;
  target: { kind: 'book'; bookId: string; pageIndex: number } | { kind: 'notebook'; pageId: string };
  points: StrokePoint[];
  style: InkStyle;
  savedAt: number;
}
