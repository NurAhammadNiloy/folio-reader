import { LibraryRepository } from '../../core/storage/libraryRepository';
import { getDb } from '../../core/storage/db';
import { download, safeFileName } from '../../components/ui';
import { sha256Hex } from '../../core/security/hash';
import type { BookRecord } from '../../core/storage/types';

export async function downloadOriginal(book: BookRecord) {
  const file = await LibraryRepository.getFile(book.id);
  if (!file) throw new Error('The original file for this book is missing. Re-import it or restore a backup.');
  download(file.blob, `${safeFileName(book.fileName.replace(/\.(pdf|epub)$/i, '') || book.title)}.${book.format}`);
}

/** Export a copy with ink marks. The stored original is read, never modified. */
export async function exportAnnotated(book: BookRecord): Promise<{ marks: number }> {
  if (book.format !== 'pdf') throw new Error('Annotated export is available for PDF books. For EPUB books, export a Folio backup to keep your notes.');
  if (book.encrypted)
    throw new Error('Annotated export is not supported for password-protected PDFs. Download the original or a Folio backup instead.');
  const file = await LibraryRepository.getFile(book.id);
  if (!file) throw new Error('The original file for this book is missing. Re-import it or restore a backup.');
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  const before = await sha256Hex(bytes);
  if (before !== book.hash) throw new Error('The stored original no longer matches its checksum. Export a backup and re-import the book.');
  const annotations = await getDb().annotations.where('bookId').equals(book.id).toArray();
  const { exportAnnotatedPdf } = await import('../../core/export/annotatedPdf');
  const out = await exportAnnotatedPdf(bytes, annotations);
  download(new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), `${safeFileName(book.title)} (annotated).pdf`);
  return { marks: annotations.length };
}
