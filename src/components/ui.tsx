import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }>(
  function Button({ variant = 'secondary', icon, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
          variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-surface-2',
          variant === 'ghost' && 'text-ink hover:bg-surface-2',
          variant === 'danger' && 'bg-danger text-white hover:brightness-110',
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean; children: ReactNode }
>(function IconButton({ label, pressed, className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-xl text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40',
        pressed && 'bg-accent-soft text-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Accessible modal dialog built on <dialog> (focus trap, Escape, focus restore). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      restore.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      restore.current?.focus?.();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        'm-auto w-[calc(100%-32px)] rounded-2xl border border-line bg-surface p-0 shadow-xl',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-5 py-4 text-sm leading-relaxed">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function TextField({
  label,
  value,
  onChange,
  autoFocus,
  type = 'text',
  hint,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  type?: string;
  hint?: string;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="mb-3">
      <label htmlFor={fid} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={fid}
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Small popover menu with keyboard support. */
export function Menu({
  label,
  trigger,
  items,
  align = 'end',
}: {
  label: string;
  trigger: ReactNode;
  items: ({ label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode } | 'sep')[];
  align?: 'start' | 'end';
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = pop.current;
    if (!p) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        const r = btn.current!.getBoundingClientRect();
        const w = p.offsetWidth;
        const left = align === 'end' ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
        const top = r.bottom + 4 + p.offsetHeight > window.innerHeight ? Math.max(8, r.top - p.offsetHeight - 4) : r.bottom + 4;
        p.style.left = `${left}px`;
        p.style.top = `${top}px`;
        p.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
      }
    };
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, [align]);
  const onKey = (e: React.KeyboardEvent) => {
    const buttons = [...(pop.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    }
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        popoverTarget={id}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl text-ink hover:bg-surface-2"
      >
        {trigger}
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onKey}
        className="fixed m-0 min-w-52 rounded-xl border border-line bg-surface p-1 text-ink shadow-xl"
      >
        {items.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="my-1 h-px bg-line" role="separator" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                pop.current?.hidePopover();
                it.onSelect();
              }}
              className={cx(
                'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-2 disabled:opacity-40',
                it.danger && 'text-danger',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
      {label}
    </span>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFileName(s: string) {
  // eslint-disable-next-line no-control-regex -- rejecting control characters is intended
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'book';
}
