import { LIMITS } from './limits';

export type ImportErrorCode =
  | 'empty'
  | 'too-large'
  | 'not-pdf'
  | 'malformed'
  | 'too-many-pages'
  | 'password-cancelled'
  | 'duplicate'
  | 'storage'
  | 'read-only'
  | 'unsupported-format';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImportError';
    this.code = code;
  }
}

function formatMiB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Checks that run before reading the file. MIME types and extensions are not trusted. */
export function precheckFile(file: { name: string; size: number; type: string }): void {
  if (file.size === 0) throw new ImportError('empty', `“${file.name}” is empty.`);
  if (file.size > LIMITS.maxPdfBytes)
    throw new ImportError(
      'too-large',
      `“${file.name}” is ${formatMiB(file.size)}. Folio currently imports books up to ${formatMiB(LIMITS.maxPdfBytes)}.`,
    );
}

/** PDF header must appear within the first 1024 bytes (as tolerated by common readers). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    )
      return true;
  }
  return false;
}

export function assertPdfSignature(name: string, bytes: Uint8Array): void {
  if (!hasPdfSignature(bytes))
    throw new ImportError('not-pdf', `“${name}” is not a PDF file. Folio opens PDF and EPUB files.`);
}

export function assertPageCount(name: string, pages: number): void {
  if (pages < 1) throw new ImportError('malformed', `“${name}” has no pages.`);
  if (pages > LIMITS.maxPdfPages)
    throw new ImportError(
      'too-many-pages',
      `“${name}” has ${pages.toLocaleString()} pages. Folio currently opens PDFs up to ${LIMITS.maxPdfPages.toLocaleString()} pages.`,
    );
}
