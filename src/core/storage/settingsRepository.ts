import { getDb, ALL_TABLES, DB_NAME } from './db';
import { mutate } from './mutate';
import { canWrite } from './lease';
import { ReadOnlyError, toStorageError } from './errors';
import { trackWrite } from './writeTracker';

export type ThemePref = 'system' | 'light' | 'dark' | 'sepia';
export type FingerMode = 'navigate' | 'draw';

export interface AppSettings {
  theme: ThemePref;
  reducedMotion: 'system' | 'reduce' | 'allow';
  /** In drawing mode: does a finger draw or navigate? Pen always draws. */
  fingerInDrawMode: FingerMode;
  /** Seconds of continuous >=50% visibility before a page qualifies as viewed. */
  qualifySeconds: number;
  /** Idle seconds after which session time stops accumulating. */
  idleSeconds: number;
  backupPromptDismissedAt: number | null;
  lastBackupAt: number | null;
  /** Reflowable (EPUB) text settings. */
  epubTypography: EpubTypography;
}

export interface EpubTypography {
  font: 'serif' | 'sans';
  /** percent of the base size, 80..200 */
  size: number;
  lineHeight: number;
  margin: 'narrow' | 'normal' | 'wide';
  justify: boolean;
  layout: 'paged' | 'scroll';
}

export const DEFAULT_TYPOGRAPHY: EpubTypography = { font: 'serif', size: 100, lineHeight: 1.6, margin: 'normal', justify: false, layout: 'paged' };

/** Stored values may come from a backup: clamp and fill instead of trusting them. */
export function normaliseTypography(v: unknown): EpubTypography {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof EpubTypography, unknown>>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    font: o.font === 'sans' ? 'sans' : 'serif',
    size: Math.round(num(o.size, 80, 200, DEFAULT_TYPOGRAPHY.size)),
    lineHeight: num(o.lineHeight, 1.2, 2.2, DEFAULT_TYPOGRAPHY.lineHeight),
    margin: o.margin === 'narrow' || o.margin === 'wide' ? o.margin : 'normal',
    justify: typeof o.justify === 'boolean' ? o.justify : DEFAULT_TYPOGRAPHY.justify,
    layout: o.layout === 'scroll' ? 'scroll' : 'paged',
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  reducedMotion: 'system',
  fingerInDrawMode: 'navigate',
  qualifySeconds: 5,
  idleSeconds: 120,
  backupPromptDismissedAt: null,
  lastBackupAt: null,
  epubTypography: DEFAULT_TYPOGRAPHY,
};

export const SettingsRepository = {
  async getAll(): Promise<AppSettings> {
    const rows = await getDb().settings.toArray();
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
    out.epubTypography = normaliseTypography(out.epubTypography);
    return out as unknown as AppSettings;
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
