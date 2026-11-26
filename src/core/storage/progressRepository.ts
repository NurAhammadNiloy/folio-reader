import { getDb } from './db';
import { mutate } from './mutate';
import { newId } from './ids';
import type { BookLocation, ReadingProgressRecord, ViewerPrefs } from './types';
import { canWrite } from './lease';

function empty(bookId: string): ReadingProgressRecord {
  return { bookId, lastLocation: null, qualifiedPages: [], completedAt: null, viewerPrefs: null, updatedAt: Date.now() };
}

export const ProgressRepository = {
  async get(bookId: string): Promise<ReadingProgressRecord> {
    return (await getDb().readingProgress.get(bookId)) ?? empty(bookId);
  },

  async listAll(): Promise<ReadingProgressRecord[]> {
    return getDb().readingProgress.toArray();
  },

  async saveLocation(bookId: string, location: BookLocation) {
    if (!canWrite()) return; // read-only tabs never write progress
    const db = getDb();
    await mutate(
      () => [db.readingProgress],
      async () => {
        const cur = (await db.readingProgress.get(bookId)) ?? empty(bookId);
        await db.readingProgress.put({ ...cur, lastLocation: location, updatedAt: Date.now() });
      },
    );
  },

  async savePrefs(bookId: string, prefs: ViewerPrefs) {
    if (!canWrite()) return;
    const db = getDb();
    await mutate(
      () => [db.readingProgress],
      async () => {
        const cur = (await db.readingProgress.get(bookId)) ?? empty(bookId);
        await db.readingProgress.put({ ...cur, viewerPrefs: prefs, updatedAt: Date.now() });
      },
    );
  },

  /** Adds qualified page indexes (unique; revisits count once). */
  async addQualifiedPages(bookId: string, pages: number[]) {
    if (!canWrite() || pages.length === 0) return;
    const db = getDb();
    await mutate(
      () => [db.readingProgress],
      async () => {
        const cur = (await db.readingProgress.get(bookId)) ?? empty(bookId);
        const set = new Set(cur.qualifiedPages);
        let changed = false;
        for (const p of pages)
          if (!set.has(p)) {
            set.add(p);
            changed = true;
          }
        if (changed)
          await db.readingProgress.put({ ...cur, qualifiedPages: [...set].sort((a, b) => a - b), updatedAt: Date.now() });
      },
    );
  },

  async setCompleted(bookId: string, completed: boolean) {
    const db = getDb();
    await mutate(
      () => [db.readingProgress],
      async () => {
        const cur = (await db.readingProgress.get(bookId)) ?? empty(bookId);
        await db.readingProgress.put({ ...cur, completedAt: completed ? Date.now() : null, updatedAt: Date.now() });
      },
    );
  },

  /** Reset qualified pages and the completion flag (resume position is kept). */
  async resetProgress(bookId: string) {
    const db = getDb();
    await mutate(
      () => [db.readingProgress],
      async () => {
        const cur = (await db.readingProgress.get(bookId)) ?? empty(bookId);
        await db.readingProgress.put({ ...cur, qualifiedPages: [], completedAt: null, updatedAt: Date.now() });
      },
    );
  },

  // Sessions ----------------------------------------------------------------

  async startSession(bookId: string, now = Date.now()): Promise<string | null> {
    if (!canWrite()) return null;
    const db = getDb();
    const id = newId();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await mutate(
      () => [db.readingSessions],
      async () => {
        await db.readingSessions.add({
          id,
          bookId,
          startedAt: now,
          activeMs: 0,
          localDate: localDate(now),
          timeZone,
          updatedAt: now,
        });
      },
    );
    return id;
  },

  async checkpointSession(id: string, activeMs: number) {
    if (!canWrite()) return;
    const db = getDb();
    await mutate(
      () => [db.readingSessions],
      async () => {
        await db.readingSessions.update(id, { activeMs: Math.max(0, Math.round(activeMs)), updatedAt: Date.now() });
      },
    );
  },

  async listSessions(bookId?: string) {
    const db = getDb();
    return bookId ? db.readingSessions.where('bookId').equals(bookId).toArray() : db.readingSessions.toArray();
  },
};

export function localDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
