import { getDb } from './db';
import { mutate } from './mutate';
import { newId } from './ids';
import { StorageError } from './errors';
import type { TextMarkRecord } from './types';

export type NewTextMark = Pick<TextMarkRecord, 'bookId' | 'pageIndex' | 'kind' | 'rects' | 'color' | 'text' | 'note'>;
export type TextMarkPatch = Partial<Pick<TextMarkRecord, 'kind' | 'color' | 'note'>>;

const MAX_NOTE = 20_000;
const MAX_TEXT = 4_000;

function validRects(rects: TextMarkRecord['rects']) {
  return rects.length > 0 && rects.length <= 500 && rects.every((r) => r.length === 4 && r.every(Number.isFinite) && r[2] >= r[0] && r[3] >= r[1]);
}

/** Text highlights, underlines and typed notes on book pages (ANN-03). */
export const TextMarkRepository = {
  async list(bookId: string): Promise<TextMarkRecord[]> {
    return getDb().textMarks.where('bookId').equals(bookId).toArray();
  },

  async add(input: NewTextMark): Promise<TextMarkRecord> {
    if (!validRects(input.rects)) throw new StorageError('constraint', 'That selection could not be marked.');
    const now = Date.now();
    const rec: TextMarkRecord = {
      ...input,
      id: newId(),
      text: input.text.slice(0, MAX_TEXT),
      note: input.note.slice(0, MAX_NOTE),
      createdAt: now,
      updatedAt: now,
    };
    const db = getDb();
    await mutate(
      () => [db.textMarks, db.books],
      async () => {
        const book = await db.books.get(input.bookId);
        if (!book) throw new StorageError('not-found', 'That book no longer exists.');
        if (book.format === 'epub') throw new StorageError('constraint', 'Text marks are available for PDFs only.');
        if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0 || input.pageIndex >= book.pageCount)
          throw new StorageError('constraint', 'That page is not in this book.');
        await db.textMarks.add(rec);
      },
    );
    return rec;
  },

  async update(id: string, patch: TextMarkPatch) {
    const clean = { ...patch };
    if (clean.note !== undefined) clean.note = clean.note.slice(0, MAX_NOTE);
    const db = getDb();
    await mutate(
      () => [db.textMarks],
      async () => {
        const n = await db.textMarks.update(id, { ...clean, updatedAt: Date.now() });
        if (!n) throw new StorageError('not-found', 'That mark no longer exists.');
      },
    );
  },

  async remove(id: string) {
    const db = getDb();
    await mutate(
      () => [db.textMarks],
      async () => {
        await db.textMarks.delete(id);
      },
    );
  },
};
