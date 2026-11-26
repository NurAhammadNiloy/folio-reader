import { useApp } from './appStore';
import { Button } from '../components/ui';
import { Lock, RefreshCw } from 'lucide-react';

export function StorageBlockedBanner() {
  const msg = useApp((s) => s.storageBlocked);
  if (!msg) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-line bg-accent-soft px-4 py-3 text-sm font-medium text-danger">
      <Lock size={16} aria-hidden />
      {msg}
    </div>
  );
}

export function LeaseBanner() {
  const lease = useApp((s) => s.lease);
  if (lease === 'owner' || lease === 'pending') return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-accent-soft px-4 py-2 text-sm text-ink">
      <Lock size={16} aria-hidden />
      {lease === 'read-only'
        ? 'Folio is open in another tab, so this tab is read-only. Close the other tab to edit here; this tab will switch automatically.'
        : 'This browser cannot coordinate editing between tabs, so Folio is read-only here. Use a current version of Safari, Chrome, Edge or Firefox.'}
    </div>
  );
}

export function UpdateBanner() {
  const needRefresh = useApp((s) => s.needRefresh);
  const pending = useApp((s) => s.pendingWrites);
  const updateSW = useApp((s) => s.updateSW);
  if (!needRefresh) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2 text-sm">
      <RefreshCw size={16} aria-hidden />
      <span className="flex-1">A new version of Folio is ready.</span>
      <Button
        variant="primary"
        disabled={pending > 0 || !updateSW}
        onClick={() => void updateSW?.(true)}
        title={pending > 0 ? 'Waiting for saving to finish' : undefined}
      >
        {pending > 0 ? 'Saving… reload when done' : 'Reload to update'}
      </Button>
    </div>
  );
}
