import type { Table, TransactionMode } from 'dexie';
import { getDb } from './db';
import { canWrite } from './lease';
import { ReadOnlyError, toStorageError } from './errors';
import { trackWrite } from './writeTracker';

/**
 * Run a read-write transaction over the given tables. Enforces the single-writer
 * lease, tracks the pending write and maps failures to typed StorageErrors.
 * Either every change inside `fn` commits or none does.
 */
export async function mutate<T>(
  tables: (db: ReturnType<typeof getDb>) => Table[],
  fn: () => Promise<T>,
  mode: TransactionMode = 'rw',
): Promise<T> {
  if (!canWrite()) throw new ReadOnlyError();
  const db = getDb();
  return trackWrite(async () => {
    try {
      return await db.transaction(mode, tables(db), fn);
    } catch (err) {
      throw toStorageError(err);
    }
  });
}
