import { useEffect, useRef, useState } from 'react';
import { HardDrive, ShieldCheck, Download, Upload, Trash2, Wifi, WifiOff, Info } from 'lucide-react';
import { useApp, errorMessage } from '../../app/appStore';
import { applyTheme } from '../../app/theme';
import { SettingsRepository, type AppSettings } from '../../core/storage/settingsRepository';
import { Button, Dialog, TextField, formatBytes } from '../../components/ui';
import { exportLibraryBackup } from '../backup/backupActions';
import { RestoreDialog } from '../backup/RestoreDialog';
import { verifyOfflineReady } from '../pwa/registerPwa';

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]" aria-labelledby={`s-${title}`}>
      <h2 id={`s-${title}`} className="mb-3 flex items-center gap-2 text-base font-semibold">
        <span className="text-accent" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Select<K extends keyof AppSettings>({ k, label, options }: { k: K; label: string; options: [AppSettings[K], string][] }) {
  const value = useApp((s) => s.settings[k]);
  const patch = useApp((s) => s.patchSettings);
  const toast = useApp((s) => s.toast);
  const id = `set-${String(k)}`;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find(([v]) => String(v) === e.target.value);
          if (!opt) return;
          patch({ [k]: opt[0] } as Partial<AppSettings>);
          applyTheme({ ...useApp.getState().settings });
          SettingsRepository.set(k, opt[0]).catch((err) => toast({ kind: 'error', message: errorMessage(err) }));
        }}
        className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm"
      >
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SettingsPage() {
  const toast = useApp((s) => s.toast);
  const offlineReady = useApp((s) => s.offlineReady);
  const lastBackupAt = useApp((s) => s.settings.lastBackupAt);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setEst((await navigator.storage?.estimate?.()) ?? null);
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      setEst(null);
    }
  };
  useEffect(() => {
    void refresh();
    void verifyOfflineReady();
  }, []);

  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-4 sm:px-6 lg:pt-8">
      <h1 className="mb-6 font-serif text-3xl font-semibold tracking-tight">Settings</h1>

      <Section title="Appearance" icon={<Info size={18} />}>
        <Select k="theme" label="Theme" options={[['system', 'Match system'], ['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']]} />
        <Select k="reducedMotion" label="Motion" options={[['system', 'Match system'], ['reduce', 'Reduce motion'], ['allow', 'Allow motion']]} />
        <p className="text-xs text-muted">Themes change the app around the page. PDF pages are shown as the author made them.</p>
      </Section>

      <Section title="Pen and reading" icon={<Info size={18} />}>
        <Select k="fingerInDrawMode" label="In drawing mode, a finger" options={[['navigate', 'Scrolls and zooms'], ['draw', 'Draws']]} />
        <Select k="qualifySeconds" label="Count a page as viewed after" options={[[3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds'], [20, '20 seconds']]} />
        <Select k="idleSeconds" label="Stop counting reading time after" options={[[60, '1 minute idle'], [120, '2 minutes idle'], [300, '5 minutes idle']]} />
        <p className="text-xs text-muted">
          “Pages viewed” and reading time are estimates based on what was on screen and recent interaction. They do not measure attention or comprehension. Apple Pencil palm rejection depends on the browser.
        </p>
      </Section>

      <Section title="Storage on this device" icon={<HardDrive size={18} />}>
        <dl className="mb-3 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">Used by Folio</dt>
          <dd data-testid="storage-usage">{est?.usage !== undefined ? formatBytes(est.usage) : 'Unknown'}</dd>
          <dt className="text-muted">Available to this site</dt>
          <dd>{est?.quota !== undefined ? formatBytes(est.quota) : 'Unknown'}</dd>
          <dt className="text-muted">Protected from automatic clearing</dt>
          <dd>{persisted === null ? 'Not supported' : persisted ? 'Yes' : 'No'}</dd>
        </dl>
        {persisted === false && (
          <Button
            onClick={async () => {
              const ok = await navigator.storage.persist().catch(() => false);
              await refresh();
              toast({ kind: ok ? 'success' : 'info', message: ok ? 'The browser agreed to keep Folio data unless you clear it.' : 'The browser did not grant persistent storage. Keep regular backups.' });
            }}
          >
            Ask the browser to keep Folio data
          </Button>
        )}
        <p className="mt-3 text-xs text-muted">
          Books and notes live in this browser only. Clearing site data, browser eviction, private browsing or using a different web address can remove access. There is no cloud copy.
        </p>
        {isSafari && (
          <p className="mt-2 rounded-lg bg-surface-2 p-3 text-xs">
            Safari keeps a separate library for the Home Screen app and for Safari tabs. Use a backup to move books between them.
          </p>
        )}
      </Section>

      <Section title="Backup and restore" icon={<ShieldCheck size={18} />}>
        <p className="mb-3 text-sm text-muted">
          A backup contains your original PDFs, marks, notebooks, bookmarks and progress in a single .folio-backup file. It is not encrypted, so store it somewhere private (for example Files or iCloud Drive).
          {lastBackupAt ? ` Last backup: ${new Date(lastBackupAt).toLocaleString()}.` : ' No backup made from this device yet.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Download size={16} />}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportLibraryBackup();
                toast({ kind: 'success', message: 'Backup downloaded.' });
              } catch (e) {
                toast({ kind: 'error', message: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Preparing…' : 'Export full backup'}
          </Button>
          <Button icon={<Upload size={16} />} onClick={() => fileInput.current?.click()} disabled={readOnly}>
            Restore from backup…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".folio-backup,application/zip"
            className="hidden"
            data-testid="restore-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setRestoreFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <p className="mt-3 text-xs text-muted">Limits: backups up to 150 MB (250 MB uncompressed). For bigger libraries, export individual books from each book’s menu.</p>
      </Section>

      <Section title="Offline" icon={offlineReady ? <Wifi size={18} /> : <WifiOff size={18} />}>
        <p className="text-sm" data-testid="offline-detail">
          {offlineReady
            ? 'Folio is installed for offline use on this device. Your imported books open without a connection.'
            : 'Folio is not yet ready for offline use. Keep this page open with a connection for a moment, then check again.'}
        </p>
        <Button className="mt-3" onClick={() => void verifyOfflineReady()}>
          Check again
        </Button>
      </Section>

      <Section title="Delete all data" icon={<Trash2 size={18} />}>
        <p className="mb-3 text-sm text-muted">Remove every book, mark, notebook and setting stored by Folio in this browser. This cannot be undone.</p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={readOnly}>
          Delete all Folio data…
        </Button>
      </Section>

      <p className="text-center text-xs text-muted">Folio (working name) · Personal, non-commercial project · Books and notes never leave this device.</p>

      <RestoreDialog file={restoreFile} onClose={() => setRestoreFile(null)} />
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete all Folio data?"
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={confirmText !== 'DELETE'}
              onClick={async () => {
                try {
                  await SettingsRepository.deleteAllData();
                  setDeleteOpen(false);
                  setConfirmText('');
                  toast({ kind: 'success', message: 'All Folio data was deleted from this browser.' });
                  void refresh();
                } catch (e) {
                  toast({ kind: 'error', message: errorMessage(e) });
                }
              }}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <p className="mb-3">Consider exporting a backup first. Type DELETE to confirm.</p>
        <TextField label="Confirmation" value={confirmText} onChange={setConfirmText} autoFocus />
      </Dialog>
    </div>
  );
}
