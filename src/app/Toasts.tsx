import { X } from 'lucide-react';
import { useApp } from './appStore';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border px-4 py-2 text-sm shadow-lg ${
            t.kind === 'error' ? 'border-danger bg-surface text-ink' : 'border-line bg-surface text-ink'
          }`}
          role={t.kind === 'error' ? 'alert' : undefined}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              className="min-h-11 rounded-lg px-2 font-semibold text-accent"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-2" onClick={() => dismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
