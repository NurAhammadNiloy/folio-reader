import { acquireLease, onLeaseChange, getLeaseState } from '../core/storage/lease';
import { onPendingWritesChange } from '../core/storage/writeTracker';
import { SettingsRepository } from '../core/storage/settingsRepository';
import { getDb } from '../core/storage/db';
import { useApp } from './appStore';
import { applyTheme } from './theme';
import { registerPwa } from '../features/pwa/registerPwa';

export function bootstrap() {
  const app = useApp.getState();
  onLeaseChange((l) => useApp.getState().setLease(l));
  onPendingWritesChange((n) => useApp.getState().setPendingWrites(n));
  acquireLease();
  app.setLease(getLeaseState());
  getDb()
    .open()
    .then(() => SettingsRepository.getAll())
    .then((s) => {
      useApp.getState().setSettings(s);
      applyTheme(s);
    })
    .catch(() => {
      useApp.getState().setSettings(useApp.getState().settings);
      useApp.getState().toast({
        kind: 'error',
        message: 'Browser storage is unavailable. Private browsing or blocked site data can prevent Folio from saving books.',
      });
    });
  applyTheme(app.settings);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useApp.getState().settings));
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyTheme(useApp.getState().settings));
  // Warn before closing with unsaved writes in flight (never relied on for durability).
  window.addEventListener('beforeunload', (e) => {
    if (useApp.getState().pendingWrites > 0) e.preventDefault();
  });
  registerPwa();
}
