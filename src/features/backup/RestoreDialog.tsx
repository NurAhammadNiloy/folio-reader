import { useEffect, useState } from 'react';
import { Button, Dialog, Spinner } from '../../components/ui';
import { errorMessage, useApp } from '../../app/appStore';
import { BackupRepository, type RestoreMode, type RestorePlan } from '../../core/storage/backupRepository';
import type { BackupBundle } from '../../core/export/backupFormat';
import { exportLibraryBackup } from './backupActions';
import { beginWrite } from '../../core/storage/writeTracker';

type Phase =
  | { kind: 'checking' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; bundle: BackupBundle; plan: RestorePlan }
  | { kind: 'restoring' }
  | { kind: 'done'; books: number };

export function RestoreDialog({ file, onClose }: { file: File | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [mode, setMode] = useState<RestoreMode>('append');
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (!file) return;
    let off = false;
    setPhase({ kind: 'checking' });
    setExported(false);
    const end = beginWrite();
    (async () => {
      try {
        const { parseBackup } = await import('../../core/export/backupFormat');
        if (file.size > 150 * 1024 * 1024) throw new Error('Backups larger than 150 MB cannot be restored.');
        const bundle = await parseBackup(new Uint8Array(await file.arrayBuffer()));
        const plan = await BackupRepository.plan(bundle);
        if (off) return;
        setMode(plan.libraryEmpty ? 'empty' : plan.conflicts.length ? 'replace' : 'append');
        setPhase({ kind: 'ready', bundle, plan });
      } catch (e) {
        if (!off) setPhase({ kind: 'invalid', message: errorMessage(e) });
      } finally {
        end();
      }
    })();
    return () => {
      off = true;
    };
  }, [file]);

  const restore = async () => {
    if (phase.kind !== 'ready') return;
    const { bundle } = phase;
    setPhase({ kind: 'restoring' });
    try {
      await BackupRepository.commit(bundle, mode);
      setPhase({ kind: 'done', books: bundle.data.books.length });
    } catch (e) {
      toast({ kind: 'error', message: errorMessage(e) });
      const plan = await BackupRepository.plan(bundle);
      setPhase({ kind: 'ready', bundle, plan });
    }
  };

  const ready = phase.kind === 'ready' ? phase : null;
  return (
    <Dialog
      open={!!file}
      onClose={() => phase.kind !== 'restoring' && onClose()}
      title="Restore from backup"
      footer={
        phase.kind === 'done' || phase.kind === 'invalid' ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={phase.kind === 'restoring'}>
              Cancel
            </Button>
            <Button
              variant={mode === 'replace' ? 'danger' : 'primary'}
              disabled={!ready || (mode === 'append' && ready.plan.conflicts.length > 0) || (mode === 'replace' && !exported && !ready.plan.libraryEmpty)}
              onClick={() => void restore()}
            >
              {mode === 'replace' ? 'Replace library' : 'Restore'}
            </Button>
          </>
        )
      }
    >
      {phase.kind === 'checking' && <Spinner label="Checking backup (sizes, file names and checksums)…" />}
      {phase.kind === 'restoring' && <Spinner label="Restoring… do not close this tab." />}
      {phase.kind === 'invalid' && (
        <p role="alert" className="text-danger">
          {phase.message} Nothing was changed.
        </p>
      )}
      {phase.kind === 'done' && <p role="status">Restore complete. {phase.books} book(s) restored with their notes and progress.</p>}
      {ready && (
        <div>
          <p className="mb-3">
            This backup contains {ready.plan.books} book(s), {ready.plan.annotations} mark(s), {ready.plan.notebooks} notebook(s) and {ready.plan.bookmarks} bookmark(s). All checksums are valid.
          </p>
          {ready.plan.libraryEmpty ? (
            <p className="mb-3">Your library is empty, so everything will be restored.</p>
          ) : (
            <fieldset className="mb-3 space-y-2">
              <legend className="mb-1 font-medium">Your library already has books</legend>
              <label className="flex min-h-11 items-start gap-3">
                <input type="radio" className="mt-1 h-5 w-5" checked={mode === 'append'} onChange={() => setMode('append')} disabled={ready.plan.conflicts.length > 0} />
                <span>
                  Add these books to my library
                  {ready.plan.conflicts.length > 0 && (
                    <span className="block text-xs text-danger">Not possible: {ready.plan.conflicts.slice(0, 3).join(' ')} Merging conflicts is not supported yet.</span>
                  )}
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input type="radio" className="mt-1 h-5 w-5" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>Replace my whole library with this backup</span>
              </label>
            </fieldset>
          )}
          {mode === 'replace' && !ready.plan.libraryEmpty && (
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="mb-2 text-sm">Replacing deletes your current library on this device. Export it first so you can go back.</p>
              <Button
                onClick={async () => {
                  try {
                    await exportLibraryBackup();
                    setExported(true);
                  } catch (e) {
                    toast({ kind: 'error', message: errorMessage(e) });
                  }
                }}
              >
                {exported ? 'Current library exported ✓' : 'Export current library first'}
              </Button>
              <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={exported} onChange={(e) => setExported(e.target.checked)} />I have a backup of my current library
              </label>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">If the restore fails or is interrupted, your current library is kept unchanged.</p>
        </div>
      )}
    </Dialog>
  );
}
