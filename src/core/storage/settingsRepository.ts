import { getDb, ALL_TABLES, DB_NAME } from './db';
import { mutate } from './mutate';
import { canWrite } from './lease';
import { ReadOnlyError, toStorageError } from './errors';
import { trackWrite } from './writeTracker';

export * from './settingsValues';
import { normaliseSettings, type AppSettings } from './settingsValues';

export const SettingsRepository = {
  async getAll(): Promise<AppSettings> {
    return normaliseSettings(await getDb().settings.toArray());
  },

  async set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const db = getDb();
    await mutate(
      () => [db.settings],
      async () => {
        await db.settings.put({ key, value });
      },
    );
  },

  /** Delete every Folio record on this device (requires explicit confirmation in UI). */
  async deleteAllData() {
    if (!canWrite()) throw new ReadOnlyError();
    const db = getDb();
    await trackWrite(async () => {
      try {
        await db.transaction(
          'rw',
          ALL_TABLES.map((t) => db.table(t)),
          async () => {
            for (const t of ALL_TABLES) if (t !== 'metadata') await db.table(t).clear();
          },
        );
      } catch (err) {
        throw toStorageError(err);
      }
    });
  },
};

export { DB_NAME };
