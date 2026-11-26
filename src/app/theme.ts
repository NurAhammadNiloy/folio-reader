import type { AppSettings } from '../core/storage/settingsRepository';

export function resolvedTheme(s: AppSettings): 'light' | 'dark' | 'sepia' {
  if (s.theme !== 'system') return s.theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function prefersReducedMotion(s: AppSettings): boolean {
  if (s.reducedMotion === 'reduce') return true;
  if (s.reducedMotion === 'allow') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyTheme(s: AppSettings) {
  const root = document.documentElement;
  const t = resolvedTheme(s);
  root.dataset.theme = t;
  root.classList.toggle('reduce-motion', prefersReducedMotion(s));
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', t === 'dark' ? '#161819' : t === 'sepia' ? '#EFE5CF' : '#F5F3EE');
}
