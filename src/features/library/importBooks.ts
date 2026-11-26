import { ImportError, assertPageCount, assertPdfSignature, precheckFile } from '../../core/security/validatePdf';
import { sha256Hex } from '../../core/security/hash';
import { LibraryRepository } from '../../core/storage/libraryRepository';
import { StorageError } from '../../core/storage/errors';
import { beginWrite } from '../../core/storage/writeTracker';
import { canWrite } from '../../core/storage/lease';
import type { BookRecord } from '../../core/storage/types';

export type ImportResult =
  | { status: 'imported'; book: BookRecord }
  | { status: 'duplicate'; book: BookRecord }
  | { status: 'cancelled' }
  | { status: 'error'; code: ImportError['code']; message: string };

export type PasswordAsk = (fileName: string, reason: 'required' | 'incorrect') => Promise<string | null>;

function titleFromFileName(name: string) {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
}

/**
 * Import one file: validate, hash, detect duplicates, parse with PDF.js (password in
 * memory only), extract metadata and cover, then commit atomically. A failed or
 * cancelled import never creates a library record (LIB-01).
 */
export async function importPdf(file: File, askPassword: PasswordAsk): Promise<ImportResult> {
  const end = beginWrite(); // blocks update reloads during the import job
  try {
    if (!canWrite()) throw new ImportError('read-only', 'This tab is read-only because Folio is open in another tab.');
    precheckFile(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    assertPdfSignature(file.name, bytes);
    const hash = await sha256Hex(bytes);
    const existing = await LibraryRepository.findByHash(hash);
    if (existing) return { status: 'duplicate', book: existing };

    const { openPdf, PasswordCancelledError, readMetadata, renderCover } = await import('../../core/documents/pdfEngine');
    let opened;
    try {
      opened = await openPdf(bytes, (reason) => askPassword(file.name, reason));
    } catch (err) {
      if (err instanceof PasswordCancelledError) return { status: 'cancelled' };
      throw new ImportError('malformed', `“${file.name}” could not be opened. The file may be damaged or use features Folio cannot read.`, { cause: err });
    }
    try {
      assertPageCount(file.name, opened.numPages);
      const meta = await readMetadata(opened.doc);
      const cover = await renderCover(opened.doc);
      const book = await LibraryRepository.addBook({
        title: meta.title || titleFromFileName(file.name),
        author: meta.author,
        hash,
        pageCount: opened.numPages,
        fileName: file.name,
        encrypted: opened.encrypted,
        file: new Blob([bytes], { type: 'application/pdf' }),
        mime: 'application/pdf',
        cover,
      });
      return { status: 'imported', book };
    } finally {
      await opened.destroy();
    }
  } catch (err) {
    if (err instanceof ImportError) return { status: 'error', code: err.code, message: err.message };
    if (err instanceof StorageError) {
      if (err.code === 'duplicate') {
        const b = await LibraryRepository.list().then((l) => l.find((x) => err.message.includes(x.title)));
        if (b) return { status: 'duplicate', book: b };
      }
      return { status: 'error', code: err.code === 'read-only' ? 'read-only' : 'storage', message: err.message };
    }
    return { status: 'error', code: 'malformed', message: `“${file.name}” could not be imported.` };
  } finally {
    end();
  }
}
