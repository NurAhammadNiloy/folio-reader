import { useEffect, useState } from 'react';
import { LibraryRepository } from '../../core/storage/libraryRepository';
import { ProgressRepository } from '../../core/storage/progressRepository';
import type { BookRecord, ReadingProgressRecord } from '../../core/storage/types';
import {
  describePage,
  openPdf,
  PasswordCancelledError,
  readPageLabels,
  type OpenedPdf,
  type PasswordReason,
} from '../../core/documents/pdfEngine';
import type { ReaderStore } from './readerStore';
import { sha256Hex } from '../../core/security/hash';

export type DocState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'missing-file'; book: BookRecord }
  | { kind: 'corrupt'; book: BookRecord; detail: string }
  | { kind: 'password'; book: BookRecord; reason: PasswordReason; submit: (pw: string | null) => void }
  | { kind: 'cancelled'; book: BookRecord }
  | { kind: 'ready'; book: BookRecord; pdf: OpenedPdf; progress: ReadingProgressRecord };

/**
 * Loads the stored original and opens it with PDF.js. One active document per reader;
 * it is destroyed when the reader closes (spec 12.4). Page sizes are described
 * progressively so very long documents open immediately.
 */
export function useReaderDocument(bookId: string, store: ReaderStore, attempt: number): DocState {
  const [state, setState] = useState<DocState>({ kind: 'loading' });

  useEffect(() => {
    let disposed = false;
    let opened: OpenedPdf | null = null;
    setState({ kind: 'loading' });
    (async () => {
      const book = await LibraryRepository.get(bookId);
      if (disposed) return;
      if (!book) return setState({ kind: 'not-found' });
      const file = await LibraryRepository.getFile(bookId);
      if (disposed) return;
      if (!file) return setState({ kind: 'missing-file', book });
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.blob.arrayBuffer());
      } catch {
        return setState({ kind: 'missing-file', book });
      }
      if ((await sha256Hex(bytes)) !== book.hash) {
        return setState({ kind: 'corrupt', book, detail: 'The stored file no longer matches its checksum.' });
      }
      try {
        opened = await openPdf(bytes, (reason) =>
          new Promise<string | null>((resolve) => {
            if (disposed) return resolve(null);
            setState({ kind: 'password', book, reason, submit: resolve });
          }),
        );
      } catch (err) {
        if (disposed) return;
        if (err instanceof PasswordCancelledError) return setState({ kind: 'cancelled', book });
        return setState({ kind: 'corrupt', book, detail: 'PDF.js could not parse the file.' });
      }
      if (disposed) {
        void opened.destroy();
        return;
      }
      const progress = await ProgressRepository.get(bookId);
      const first = await describePage(await opened.doc.getPage(1), 0);
      store.getState().init(opened.numPages, first, progress.viewerPrefs, book.direction);
      void readPageLabels(opened.doc).then((l) => !disposed && store.getState().setLabels(l));
      void LibraryRepository.markOpened(bookId).catch(() => undefined);
      setState({ kind: 'ready', book, pdf: opened, progress });
      // Describe remaining pages in batches without blocking first paint.
      const doc = opened.doc;
      const batch: Awaited<ReturnType<typeof describePage>>[] = [];
      for (let i = 2; i <= opened.numPages && !disposed; i++) {
        try {
          batch.push(await describePage(await doc.getPage(i), i - 1));
        } catch {
          /* leave as estimated size */
        }
        if (batch.length >= 40 || i === opened.numPages) {
          store.getState().setPages(batch.splice(0));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    })().catch(() => {
      if (!disposed) setState({ kind: 'not-found' });
    });
    return () => {
      disposed = true;
      if (opened) void opened.destroy();
    };
  }, [bookId, store, attempt]);

  return state;
}
