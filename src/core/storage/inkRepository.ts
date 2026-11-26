import { getDb } from './db';
import { mutate } from './mutate';
import type { AnnotationRecord, InkCheckpointRecord } from './types';
import { finitePoints } from '../ink/geometry';
import { StorageError } from './errors';

/** Ink persistence. Every committed stroke or erase is one transaction (spec 12.3). */
export const InkRepository = {
  async listForBook(bookId: string): Promise<AnnotationRecord[]> {
    return getDb().annotations.where('bookId').equals(bookId).toArray();
  },

  async addStrokes(strokes: AnnotationRecord[], clearCheckpointId?: string) {
    for (const s of strokes)
      if (!finitePoints(s.points) || s.outline.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))
        throw new StorageError('constraint', 'A stroke contained invalid coordinates and was not saved.');
    const db = getDb();
    await mutate(
      () => [db.annotations, db.inkCheckpoints],
      async () => {
        await db.annotations.bulkPut(strokes);
        if (clearCheckpointId) await db.inkCheckpoints.delete(clearCheckpointId);
      },
    );
  },

  async removeStrokes(ids: string[]) {
    const db = getDb();
    await mutate(
      () => [db.annotations],
      async () => {
        await db.annotations.bulkDelete(ids);
      },
    );
  },

  async saveCheckpoint(cp: InkCheckpointRecord) {
    const db = getDb();
    await mutate(
      () => [db.inkCheckpoints],
      async () => {
        await db.inkCheckpoints.put(cp);
      },
    );
  },

  async clearCheckpoint(id: string) {
    const db = getDb();
    await mutate(
      () => [db.inkCheckpoints],
      async () => {
        await db.inkCheckpoints.delete(id);
      },
    );
  },

  async checkpointsForBook(bookId: string) {
    return getDb().inkCheckpoints.where('bookId').equals(bookId).toArray();
  },
};
