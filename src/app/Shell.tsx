import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, NotebookPen, Settings, WifiOff, CheckCircle2 } from 'lucide-react';
import { LeaseBanner, UpdateBanner } from './Banners';
import { useApp } from './appStore';
import { cx } from '../components/ui';

const NAV = [
  { to: '/', label: 'Library', icon: BookOpen, end: true },
  { to: '/notes', label: 'Notes', icon: NotebookPen, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

function OfflineBadge() {
  const ready = useApp((s) => s.offlineReady);
  return (
    <p className="flex items-center gap-2 px-3 text-xs text-muted" data-testid="offline-status">
      {ready ? <CheckCircle2 size={14} className="text-accent" aria-hidden /> : <WifiOff size={14} aria-hidden />}
      {ready ? 'Ready to use offline' : 'Not yet available offline'}
    </p>
  );
}

export function Shell() {
  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only-focusable fixed left-2 top-2 z-50 rounded-lg bg-surface px-3 py-2">
        Skip to content
      </a>
      <UpdateBanner />
      <LeaseBanner />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main" className="safe-pt hidden w-60 flex-none flex-col border-r border-line bg-surface/60 p-3 lg:flex">
          <div className="mb-6 flex items-center gap-2 px-3 pt-2">
            <img src="./icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
            <span className="font-serif text-xl font-semibold tracking-tight">Folio</span>
          </div>
          <ul className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cx('flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium', isActive ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface-2')
                  }
                >
                  <Icon size={18} aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-auto pb-2">
            <OfflineBadge />
            <p className="mt-2 px-3 text-xs text-muted">Books and notes stay on this device.</p>
          </div>
        </nav>
        <main id="main" className="min-w-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <nav aria-label="Main" className="safe-pb fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="mx-auto flex max-w-md justify-around">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium', isActive ? 'text-accent' : 'text-muted')
                }
              >
                <Icon size={20} aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
