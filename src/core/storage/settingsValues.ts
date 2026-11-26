export type ThemePref = 'system' | 'light' | 'dark' | 'sepia';
export type FingerMode = 'navigate' | 'draw';

export interface AppSettings {
  theme: ThemePref;
  reducedMotion: 'system' | 'reduce' | 'allow';
  /** Page-turn motion when motion is allowed. */
  pageTurn: 'curl' | 'slide';
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
  pageTurn: 'curl',
  fingerInDrawMode: 'navigate',
  qualifySeconds: 5,
  idleSeconds: 120,
  backupPromptDismissedAt: null,
  lastBackupAt: null,
  epubTypography: DEFAULT_TYPOGRAPHY,
};

const THEMES: readonly ThemePref[] = ['system', 'light', 'dark', 'sepia'];
const MOTION: readonly AppSettings['reducedMotion'][] = ['system', 'reduce', 'allow'];
const FINGER: readonly FingerMode[] = ['navigate', 'draw'];
const MAX_TS = 8.64e15;

/**
 * Validate one stored setting. Values can come from a restored backup, so each
 * known key has its own rule; unknown keys and bad values give undefined (the
 * default is used instead).
 */
export function sanitiseSetting(key: string, v: unknown): unknown {
  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return undefined;
  const int = (lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  switch (key as keyof AppSettings) {
    case 'theme':
      return THEMES.includes(v as ThemePref) ? v : undefined;
    case 'reducedMotion':
      return MOTION.includes(v as AppSettings['reducedMotion']) ? v : undefined;
    case 'pageTurn':
      return v === 'curl' || v === 'slide' ? v : undefined;
    case 'fingerInDrawMode':
      return FINGER.includes(v as FingerMode) ? v : undefined;
    case 'qualifySeconds':
      return int(1, 60);
    case 'idleSeconds':
      return int(10, 3600);
    case 'backupPromptDismissedAt':
    case 'lastBackupAt':
      return v === null ? null : int(0, MAX_TS);
    case 'epubTypography':
      return normaliseTypography(v);
  }
}

export function normaliseSettings(rows: readonly { key: string; value: unknown }[]): AppSettings {
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const v = sanitiseSetting(r.key, r.value);
    if (v !== undefined) (out as unknown as Record<string, unknown>)[r.key] = v;
  }
  return out;
}
