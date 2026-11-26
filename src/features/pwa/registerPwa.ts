import { useApp } from '../../app/appStore';

// Prompt-mode service worker (spec 12.5): new versions wait until the user reloads,
// and reload is refused while writes, imports or restores are in progress.
export function registerPwa() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        useApp.getState().setPwa({ needRefresh: true });
      },
      onOfflineReady() {
        markOfflineReady();
      },
      onRegisteredSW(_url, reg) {
        // Already-installed worker controlling this page => assets are precached.
        if (reg?.active && navigator.serviceWorker.controller) markOfflineReady();
      },
    });
    useApp.getState().setPwa({ updateSW });
  });
  if (navigator.serviceWorker.controller) void verifyOfflineReady();
}

function markOfflineReady() {
  void verifyOfflineReady();
}

/** Confirm readiness by checking the precache actually contains the app shell and PDF worker. */
export async function verifyOfflineReady(): Promise<boolean> {
  try {
    const keys = await caches.keys();
    for (const k of keys) {
      if (!k.includes('precache')) continue;
      const cache = await caches.open(k);
      const reqs = await cache.keys();
      const urls = reqs.map((r) => r.url);
      const hasShell = urls.some((u) => /index\.html/.test(u));
      const hasWorker = urls.some((u) => /pdf\.worker/.test(u));
      const hasCmaps = urls.some((u) => /pdfjs\/cmaps\//.test(u));
      if (hasShell && hasWorker && hasCmaps) {
        useApp.getState().setPwa({ offlineReady: true });
        return true;
      }
    }
  } catch {
    /* caches unavailable */
  }
  useApp.getState().setPwa({ offlineReady: false });
  return false;
}
