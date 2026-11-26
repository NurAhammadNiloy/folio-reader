import { create } from 'zustand';
import type { LeaseState } from '../core/storage/lease';
import { DEFAULT_SETTINGS, type AppSettings } from '../core/storage/settingsRepository';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  settings: AppSettings;
  settingsLoaded: boolean;
  lease: LeaseState;
  pendingWrites: number;
  offlineReady: boolean;
  needRefresh: boolean;
  updateSW: ((reload?: boolean) => Promise<void>) | null;
  toasts: Toast[];
  setSettings: (s: AppSettings) => void;
  patchSettings: (p: Partial<AppSettings>) => void;
  setLease: (l: LeaseState) => void;
  setPendingWrites: (n: number) => void;
  setPwa: (p: Partial<Pick<AppState, 'offlineReady' | 'needRefresh' | 'updateSW'>>) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useApp = create<AppState>((set) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  lease: 'pending',
  pendingWrites: 0,
  offlineReady: false,
  needRefresh: false,
  updateSW: null,
  toasts: [],
  setSettings: (settings) => set({ settings, settingsLoaded: true }),
  patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setLease: (lease) => set({ lease }),
  setPendingWrites: (pendingWrites) => set({ pendingWrites }),
  setPwa: (p) => set(p),
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    if (t.kind !== 'error' || !t.action)
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 9000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}
