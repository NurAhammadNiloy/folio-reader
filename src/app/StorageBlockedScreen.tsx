import { useEffect } from 'react';
import { applyTheme } from './theme';
import { DEFAULT_SETTINGS } from '../core/storage/settingsRepository';

export const NEWER_LIBRARY_MESSAGE =
  'Your library was saved by a newer version of Folio, so this older version will not open it. Reload to get the latest version. Nothing was changed.';

export function StorageBlockedScreen() {
  useEffect(() => applyTheme(DEFAULT_SETTINGS), []);
  return (
    <main className="flex h-full items-center justify-center bg-bg p-6">
      <div role="alert" className="max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        <h1 className="mb-2 font-serif text-xl font-semibold">Folio needs an update</h1>
        <p className="mb-4 text-sm text-muted">{NEWER_LIBRARY_MESSAGE}</p>
        <button type="button" className="min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-white" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}
