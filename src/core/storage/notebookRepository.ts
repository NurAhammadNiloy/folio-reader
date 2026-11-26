import { getDb } from './db';
import { mutate } from './mutate';
import { newId } from './ids';
import { StorageError } from './errors';
import type { NotebookPageRecord, NotebookRecord, NotebookTemplate } from './types';

export const A4 = { width: 595, height: 842 };

function blankPage(notebookId: string, order: number, template: NotebookTemplate): NotebookPageRecord {
  const now = Date.now();
  return { id: newId(), notebookId, order, width: A4.width, height: A4.height, template, strokes: [], textBlocks: [], link: null, createdAt: now, updatedAt: now };
}

export const NotebookRepository = {
  async forBook(bookId: string): Promise<NotebookRecord[]> {
    return getDb().notebooks.where('linkedBookId').equals(bookId).toArray();
  },
  async get(id: string) {
    return getDb().notebooks.get(id);
  },
  async pages(notebookId: string): Promise<NotebookPageRecord[]> {
    return getDb().notebookPages.where('[notebookId+order]').between([notebookId, -Infinity], [notebookId, Infinity]).toArray();
  },

  async create(title: string, linkedBookId: string | null, template: NotebookTemplate = 'ruled'): Promise<NotebookRecord> {
    const now = Date.now();
    const nb: NotebookRecord = { id: newId(), title: title.trim() || 'Notebook', linkedBookId, template, createdAt: now, updatedAt: now };
    const db = getDb();
    await mutate(
      () => [db.notebooks, db.notebookPages, db.books],
      async () => {
        if (linkedBookId && !(await db.books.get(linkedBookId))) throw new StorageError('not-found', 'That book no longer exists.');
        await db.notebooks.add(nb);
        await db.notebookPages.add(blankPage(nb.id, 0, template));
      },
    );
    return nb;
  },

  async rename(id: string, title: string) {
    const db = getDb();
    await mutate(
      () => [db.notebooks],
      async () => {
        await db.notebooks.update(id, { title: title.trim() || 'Notebook', updatedAt: Date.now() });
      },
    );
  },

  async remove(id: string) {
    const db = getDb();
    await mutate(
      () => [db.notebooks, db.notebookPages],
      async () => {
        await db.notebookPages.where('notebookId').equals(id).delete();
        await db.notebooks.delete(id);
      },
    );
  },

  async addPage(notebookId: string, afterOrder: number | null, template: NotebookTemplate): Promise<NotebookPageRecord> {
    const db = getDb();
    let created!: NotebookPageRecord;
    await mutate(
      () => [db.notebooks, db.notebookPages],
      async () => {
        const pages = await this.pages(notebookId);
        const insertAt = afterOrder === null ? pages.length : afterOrder + 1;
        for (const p of pages) if (p.order >= insertAt) await db.notebookPages.update(p.id, { order: p.order + 1 });
        created = blankPage(notebookId, insertAt, template);
        await db.notebookPages.add(created);
        await db.notebooks.update(notebookId, { updatedAt: Date.now() });
      },
    );
    return created;
  },

  async deletePage(pageId: string) {
    const db = getDb();
    await mutate(
      () => [db.notebooks, db.notebookPages],
      async () => {
        const page = await db.notebookPages.get(pageId);
        if (!page) return;
        const pages = await this.pages(page.notebookId);
        if (pages.length <= 1) throw new StorageError('constraint', 'A notebook needs at least one page.');
        await db.notebookPages.delete(pageId);
        let i = 0;
        for (const p of pages) if (p.id !== pageId) await db.notebookPages.update(p.id, { order: i++ });
        await db.notebooks.update(page.notebookId, { updatedAt: Date.now() });
      },
    );
  },

  async movePage(pageId: string, delta: -1 | 1) {
    const db = getDb();
    await mutate(
      () => [db.notebookPages],
      async () => {
        const page = await db.notebookPages.get(pageId);
        if (!page) return;
        const pages = await this.pages(page.notebookId);
        const idx = pages.findIndex((p) => p.id === pageId);
        const other = pages[idx + delta];
        if (!other) return;
        await db.notebookPages.update(page.id, { order: other.order });
        await db.notebookPages.update(other.id, { order: page.order });
      },
    );
  },

  /** Replace a page's mutable content in one transaction. */
  async savePage(page: NotebookPageRecord) {
    const db = getDb();
    await mutate(
      () => [db.notebooks, db.notebookPages, db.inkCheckpoints],
      async () => {
        const existing = await db.notebookPages.get(page.id);
        if (!existing) throw new StorageError('not-found', 'That notebook page no longer exists.');
        await db.notebookPages.put({ ...page, updatedAt: Date.now() });
        await db.notebooks.update(page.notebookId, { updatedAt: Date.now() });
        await db.inkCheckpoints.delete(`nb:${page.id}`);
      },
    );
  },
};
