import { AlertTriangle, CheckCircle2, Copy, X } from 'lucide-react';
import { Spinner } from '../../components/ui';
import type { ImportResult } from './importBooks';

export interface ImportItem {
  key: string;
  name: string;
  state: 'working' | 'done';
  result?: ImportResult;
}

export function ImportPanel({ items, onClear, onOpen }: { items: ImportItem[]; onClear: () => void; onOpen: (id: string) => void }) {
  if (!items.length) return null;
  const allDone = items.every((i) => i.state === 'done');
  return (
    <section aria-label="Import results" className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-3" aria-live="polite">
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 className="text-sm font-semibold">Import</h2>
        {allDone && (
          <button className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Dismiss import results" onClick={onClear}>
            <X size={16} />
          </button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center gap-3 px-2 py-2 text-sm" data-testid="import-row">
            <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
            {it.state === 'working' && <Spinner label="Checking and saving…" />}
            {it.result?.status === 'imported' && (
              <span className="flex items-center gap-2 text-accent">
                <CheckCircle2 size={16} aria-hidden /> Added to library
                <button className="min-h-11 rounded-lg px-2 font-semibold underline" onClick={() => onOpen(it.result!.status === 'imported' ? (it.result as { book: { id: string } }).book.id : '')}>
                  Open
                </button>
              </span>
            )}
            {it.result?.status === 'duplicate' && (
              <span className="flex items-center gap-2 text-muted">
                <Copy size={16} aria-hidden /> Already in your library as “{it.result.book.title}”
                <button className="min-h-11 rounded-lg px-2 font-semibold text-accent underline" onClick={() => onOpen((it.result as { book: { id: string } }).book.id)}>
                  Open existing
                </button>
              </span>
            )}
            {it.result?.status === 'cancelled' && <span className="text-muted">Cancelled. Nothing was added.</span>}
            {it.result?.status === 'error' && (
              <span className="flex w-full items-start gap-2 text-danger sm:w-auto" role="alert">
                <AlertTriangle size={16} className="mt-0.5 flex-none" aria-hidden /> {it.result.message}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
