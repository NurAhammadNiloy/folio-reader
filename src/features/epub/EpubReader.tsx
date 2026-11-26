import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  List,
  MoreHorizontal,
  NotebookPen,
  Search,
  Type,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  ExternalLink,
  FileX2,
  AlertTriangle,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Dialog, IconButton, Menu, Spinner, cx } from '../../components/ui';
import { useApp, errorMessage } from '../../app/appStore';
import { prefersReducedMotion } from '../../app/theme';
import { getDb } from '../../core/storage/db';
import { LibraryRepository } from '../../core/storage/libraryRepository';
import { ProgressRepository } from '../../core/storage/progressRepository';
import { BookmarkRepository } from '../../core/storage/bookmarkRepository';
import { SettingsRepository, normaliseTypography, type EpubTypography, type ThemePref } from '../../core/storage/settingsRepository';
import { sha256Hex } from '../../core/security/hash';
import type { BookRecord, EpubLocation } from '../../core/storage/types';
import type { EpubHandle, EpubTocItem } from '../../core/documents/epubEngine';
import { useReader, type ReaderStore } from '../reader/readerStore';
import { useReadingTracking } from '../reader/useReadingTracking';
import type { Visibility } from '../reader/ReaderView';
import { downloadOriginal } from '../export/bookActions';
import { storedBlob } from '../../core/storage/types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'missing-file'; book: BookRecord }
  | { kind: 'corrupt'; book: BookRecord; detail: string }
  | { kind: 'ready'; book: BookRecord; handle: EpubHandle; start: EpubLocation | null };

function useEpubDocument(bookId: string, store: ReaderStore): LoadState {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    let handle: EpubHandle | null = null;
    (async () => {
      const book = await getDb().books.get(bookId);
      if (!book) return setState({ kind: 'not-found' });
      const file = await LibraryRepository.getFile(bookId);
      if (!file) return setState({ kind: 'missing-file', book });
      const bytes = new Uint8Array(await storedBlob(file.blob, file.mime).arrayBuffer());
      if ((await sha256Hex(bytes)) !== book.hash) return setState({ kind: 'corrupt', book, detail: 'The stored file does not match its checksum.' });
      const { parseEpub, EpubHandle: Handle } = await import('../../core/documents/epubEngine');
      let parsed;
      try {
        parsed = parseEpub(bytes);
      } catch (err) {
        return setState({ kind: 'corrupt', book, detail: errorMessage(err) });
      }
      if (cancelled) return;
      handle = new Handle(parsed);
      const progress = await ProgressRepository.get(bookId);
      void LibraryRepository.markOpened(bookId).catch(() => undefined);
      const loc = progress.lastLocation?.kind === 'epub' ? progress.lastLocation : null;
      const start = loc && loc.spineIndex < parsed.spine.length ? loc : null;
      store.getState().set({ numPages: parsed.spine.length, labels: null, direction: book.direction, current: start?.spineIndex ?? 0 });
      if (!cancelled) setState({ kind: 'ready', book, handle, start });
    })().catch((err) => {
      if (!cancelled) setState({ kind: 'not-found' });
      console.warn('Folio: could not open EPUB', err);
    });
    return () => {
      cancelled = true;
      handle?.close();
    };
  }, [bookId, store]);
  return state;
}

export function EpubReader(props: { bookId: string; store: ReaderStore; onBack?: () => void; onStudy?: () => void; embedded?: boolean }) {
  const doc = useEpubDocument(props.bookId, props.store);
  if (doc.kind === 'loading')
    return (
      <div className="flex h-full items-center justify-center bg-[var(--reader-bg)]">
        <Spinner label="Opening book…" />
      </div>
    );
  if (doc.kind === 'not-found') return <Message icon={<FileX2 />} title="Book not found" body="This book is not in your library on this device." />;
  if (doc.kind === 'missing-file') return <Message icon={<FileX2 />} title="The EPUB file is missing" body={`Folio has the details for “${doc.book.title}” but not its file. Re-import it or restore a backup.`} />;
  if (doc.kind === 'corrupt')
    return (
      <Message
        icon={<AlertTriangle />}
        title="This EPUB could not be opened"
        body={`“${doc.book.title}”: ${doc.detail}`}
        action={<Button onClick={() => void downloadOriginal(doc.book).catch(() => undefined)}>Download stored original</Button>}
      />
    );
  return <ReadyEpub {...props} book={doc.book} handle={doc.handle} start={doc.start} />;
}

function Message({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center" role="alert">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</div>
        <h1 className="mb-2 font-serif text-xl font-semibold">{title}</h1>
        <p className="mb-4 text-sm text-muted">{body}</p>
        {action}
      </div>
    </div>
  );
}

interface Hit {
  spineIndex: number;
  nth: number; // occurrence within the chapter
  snippet: string;
}

const MARGINS = { narrow: 16, normal: 40, wide: 80 } as const;
const PHONE_MARGINS = { narrow: 12, normal: 22, wide: 36 } as const;
const GAP_FACTOR = 2; // column gap = 2 × margin

function ReadyEpub({
  book,
  handle,
  start,
  store,
  onBack,
  onStudy,
  embedded,
}: {
  book: BookRecord;
  handle: EpubHandle;
  start: EpubLocation | null;
  store: ReaderStore;
  onBack?: () => void;
  onStudy?: () => void;
  embedded?: boolean;
}) {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const toast = useApp((s) => s.toast);
  const lease = useApp((s) => s.lease);
  const readOnly = lease !== 'owner';
  const typo = normaliseTypography(settings.epubTypography);
  const reducedMotion = prefersReducedMotion(settings);
  const rtl = book.direction === 'rtl';
  const n = handle.book.spine.length;

  const spine = useReader(store, (s) => s.current);
  const nav = useReader(store, (s) => s.nav);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<null | 'toc' | 'search' | 'bookmarks' | 'type'>(null);
  const [external, setExternal] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [search, setSearch] = useState<{ query: string; hits: Hit[]; active: number }>({ query: '', hits: [], active: -1 });

  const view = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Where to land after the next chapter render: fraction, fragment, last page or a search hit.
  const pending = useRef<{ fraction?: number; fragment?: string | null; last?: boolean; hit?: number }>(start ? { fraction: start.fraction } : {});
  const pageRef = useRef(0);
  pageRef.current = page;
  const pageCountRef = useRef(1);
  pageCountRef.current = pageCount;

  const margin = (box.w && box.w < 600 ? PHONE_MARGINS : MARGINS)[typo.margin];
  const paged = typo.layout === 'paged';
  const twoUp = paged && box.w >= 1000 && box.w > box.h;
  const colW = Math.max(200, twoUp ? (box.w - 2 * margin - GAP_FACTOR * margin) / 2 : box.w - 2 * margin);
  const step = box.w - 2 * margin + GAP_FACTOR * margin; // one screen of columns

  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- render the chapter (inert, sanitised DOM) ----
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    el.replaceChildren(handle.render(spine));
    highlight(el, search.query);
  }, [handle, spine, search.query]);

  // ---- measure pages and apply pending landing position ----
  const measure = useCallback(() => {
    const el = content.current;
    if (!el || !box.w) return;
    if (!paged) {
      setPageCount(1);
      return;
    }
    const count = Math.max(1, Math.round((el.scrollWidth + GAP_FACTOR * margin) / step));
    setPageCount(count);
    return count;
  }, [box.w, paged, step, margin]);

  const land = useCallback(() => {
    const el = content.current;
    const v = view.current;
    if (!el || !v) return;
    const count = measure() ?? 1;
    const p = pending.current;
    pending.current = {};
    let target: HTMLElement | null = null;
    if (p.hit !== undefined) {
      const marks = el.querySelectorAll<HTMLElement>('mark.folio-hit');
      marks.forEach((m) => m.classList.remove('active'));
      target = marks[Math.min(p.hit, marks.length - 1)] ?? null;
      target?.classList.add('active');
    } else if (p.fragment) target = el.querySelector<HTMLElement>(`#${CSS.escape(`epub-${spine}-${p.fragment}`)}`);
    if (paged) {
      let next = 0;
      if (target) {
        const er = target.getBoundingClientRect();
        const cr = el.getBoundingClientRect();
        const dx = rtl ? cr.right - er.right : er.left - cr.left;
        // Both rects carry the same translate, so dx is the offset from the chapter start.
        next = Math.floor((dx + 1) / step);
      } else if (p.last) next = count - 1;
      else if (p.fraction !== undefined) next = Math.floor(p.fraction * count + 1e-6);
      setPage(Math.max(0, Math.min(count - 1, next)));
    } else {
      if (target) target.scrollIntoView({ block: 'center' });
      else if (p.last) v.scrollTop = v.scrollHeight;
      else v.scrollTop = (p.fraction ?? 0) * Math.max(0, v.scrollHeight - v.clientHeight);
    }
  }, [measure, paged, rtl, spine, step]);

  useLayoutEffect(() => {
    land();
    // Images and fonts change layout after insertion.
    const el = content.current;
    if (!el) return;
    const imgs = [...el.querySelectorAll('img')];
    const onLoad = () => measure();
    imgs.forEach((i) => i.addEventListener('load', onLoad));
    return () => imgs.forEach((i) => i.removeEventListener('load', onLoad));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-land only when layout inputs change
  }, [spine, box.w, box.h, typo.size, typo.lineHeight, typo.font, typo.margin, typo.layout, search.query]);

  // ---- navigation ----
  const goChapter = useCallback(
    (i: number, where: { fraction?: number; fragment?: string | null; last?: boolean; hit?: number } = {}) => {
      if (i < 0 || i >= n) return;
      pending.current = where;
      if (i === store.getState().current) land();
      else store.getState().setCurrent(i);
    },
    [land, n, store],
  );
  const next = useCallback(() => {
    if (paged && pageRef.current < pageCountRef.current - 1) setPage((p) => p + 1);
    else if (paged) goChapter(spine + 1);
    else {
      const v = view.current!;
      if (v.scrollTop + v.clientHeight >= v.scrollHeight - 4) goChapter(spine + 1);
      else v.scrollTop = Math.min(v.scrollHeight - v.clientHeight, v.scrollTop + v.clientHeight * 0.9);
    }
  }, [goChapter, paged, spine]);
  const prev = useCallback(() => {
    if (paged && pageRef.current > 0) setPage((p) => p - 1);
    else if (paged) goChapter(spine - 1, { last: true });
    else {
      const v = view.current!;
      if (v.scrollTop <= 4) goChapter(spine - 1, { last: true });
      else v.scrollTop = Math.max(0, v.scrollTop - v.clientHeight * 0.9);
    }
  }, [goChapter, paged, spine]);

  // External navigation requests (study pane, notebook links) arrive through the store.
  const lastNav = useRef(nav?.seq ?? 0);
  useEffect(() => {
    if (!nav || nav.seq === lastNav.current) return;
    lastNav.current = nav.seq;
    pending.current = { fraction: nav.yFraction };
    land();
  }, [nav, land]);

  // ---- location persistence ----
  const [scrollFrac, setScrollFrac] = useState(0);
  const fraction = paged ? page / Math.max(1, pageCount) : scrollFrac;
  const saveTimer = useRef(0);
  const save = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const v = view.current;
    const f = paged ? pageRef.current / Math.max(1, pageCountRef.current) : v ? v.scrollTop / Math.max(1, v.scrollHeight - v.clientHeight) : 0;
    const loc: EpubLocation = { kind: 'epub', spineIndex: store.getState().current, fraction: Math.round(Math.min(1, Math.max(0, f)) * 1000) / 1000 };
    void ProgressRepository.saveLocation(book.id, loc).catch(() => undefined);
  }, [book.id, paged, store]);
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 400);
  }, [save]);
  useEffect(() => {
    const raf = requestAnimationFrame(save);
    return () => cancelAnimationFrame(raf);
  }, [spine, page, save]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [save]);

  // ---- progress: a chapter qualifies once its end has been on screen for qualifySeconds ----
  const visibility = useRef<Visibility>({ pages: new Map(), viewportArea: 1 });
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    visibility.current = { pages: atEnd ? new Map([[spine, { visible: 1, area: 1 }]]) : new Map(), viewportArea: 1 };
  }, [atEnd, spine]);
  useEffect(() => {
    if (paged) setAtEnd(page >= pageCount - 1);
  }, [paged, page, pageCount]);
  useReadingTracking(book.id, visibility, { qualifySeconds: settings.qualifySeconds, idleSeconds: settings.idleSeconds, enabled: !readOnly });

  // ---- input: keys, taps, swipes, links ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setPanel('search');
        }
        return;
      }
      const fwd = rtl ? prev : next;
      const back = rtl ? next : prev;
      if (e.key === 'ArrowRight') (paged ? fwd : next)();
      else if (e.key === 'ArrowLeft') (paged ? back : prev)();
      else if (e.key === 'PageDown' || (e.key === ' ' && paged)) {
        e.preventDefault();
        next();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        prev();
      } else if (e.key === 'Escape') setPanel(null);
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, paged, rtl]);

  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const onContentClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const internal = t.closest<HTMLElement>('[data-spine]');
    if (internal) {
      e.preventDefault();
      goChapter(Number(internal.dataset.spine), { fragment: internal.dataset.fragment ?? null });
      return;
    }
    const ext = t.closest<HTMLElement>('[data-external-url]');
    if (ext) {
      setExternal(ext.dataset.externalUrl ?? null);
      return;
    }
    if (window.getSelection()?.toString()) return;
    if (!paged) return setChrome((c) => !c);
    const r = view.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 0.25) (rtl ? next : prev)();
    else if (x > 0.75) (rtl ? prev : next)();
    else setChrome((c) => !c);
  };
  const onKeyActivate = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.dataset.spine || t.dataset.externalUrl) {
      e.preventDefault();
      onContentClick(e as unknown as React.MouseEvent);
    }
  };

  // ---- search across all chapters ----
  const runSearch = (q: string) => {
    const query = q.trim();
    if (query.length < 2) return setSearch({ query: '', hits: [], active: -1 });
    const hits: Hit[] = [];
    const needle = query.toLocaleLowerCase();
    for (let i = 0; i < n && hits.length < 500; i++) {
      const text = handle.text(i);
      const hay = text.toLocaleLowerCase();
      let from = 0;
      let nth = 0;
      for (;;) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        hits.push({ spineIndex: i, nth: nth++, snippet: text.slice(Math.max(0, at - 40), at + query.length + 40) });
        from = at + needle.length;
      }
    }
    setSearch({ query, hits, active: hits.length ? 0 : -1 });
    if (hits[0]) goChapter(hits[0].spineIndex, { hit: hits[0].nth });
  };
  const goHit = (i: number) => {
    const h = search.hits[i];
    if (!h) return;
    setSearch((s) => ({ ...s, active: i }));
    goChapter(h.spineIndex, { hit: h.nth });
  };

  // ---- bookmarks ----
  const bookmarks = useLiveQuery(() => getDb().bookmarks.where('bookId').equals(book.id).toArray(), [book.id]) ?? [];
  const here = bookmarks.find((b) => b.location.kind === 'epub' && b.location.spineIndex === spine && Math.abs(b.location.fraction - fraction) < 1 / Math.max(2, pageCount));
  const chapterTitle = useMemo(() => {
    // The first (shallowest) entry for this section, else the nearest earlier one.
    const own = handle.book.toc.filter((i) => i.spineIndex === spine).sort((a, b) => a.depth - b.depth)[0];
    let t: EpubTocItem | undefined = own;
    if (!t) for (const item of handle.book.toc) if (item.spineIndex < spine && (!t || item.spineIndex >= t.spineIndex)) t = item;
    return t?.title ?? `Section ${spine + 1}`;
  }, [handle, spine]);
  const toggleBookmark = () => {
    const fail = (e: unknown) => toast({ kind: 'error', message: errorMessage(e) });
    if (here) void BookmarkRepository.remove(here.id).catch(fail);
    else void BookmarkRepository.add(book.id, { kind: 'epub', spineIndex: spine, fraction: Math.round(fraction * 1000) / 1000 }, chapterTitle).catch(fail);
  };

  const setTypo = (p: Partial<EpubTypography>) => {
    const v = normaliseTypography({ ...typo, ...p });
    patch({ epubTypography: v });
    void SettingsRepository.set('epubTypography', v).catch(() => undefined);
  };
  const setTheme = (theme: ThemePref) => {
    patch({ theme });
    void SettingsRepository.set('theme', theme).catch(() => undefined);
    import('../../app/theme').then((m) => m.applyTheme({ ...useApp.getState().settings, theme }));
  };

  const fontFamily = typo.font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)';
  const showChrome = chrome || !!panel;
  const translate = paged ? (rtl ? 1 : -1) * page * step : 0;
  const bookProgress = n ? Math.round(((spine + (paged ? (page + 1) / pageCount : fraction)) / n) * 100) : 0;

  return (
    <div className="relative flex h-full flex-col bg-[var(--reader-bg)]" data-testid="epub-reader">
      {showChrome && (
        <header className="safe-pt z-20 flex items-center gap-1 border-b border-line bg-surface/95 px-2 py-1 backdrop-blur">
          {onBack && (
            <IconButton label="Back to library" onClick={onBack}>
              <ArrowLeft size={20} />
            </IconButton>
          )}
          <h1 className={cx('min-w-0 flex-1 truncate px-1 text-sm font-semibold', embedded && 'sr-only')}>{book.title}</h1>
          {embedded && <span className="flex-1" />}
          <IconButton label="Contents" pressed={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}>
            <List size={20} />
          </IconButton>
          <IconButton label="Search in book" pressed={panel === 'search'} onClick={() => setPanel(panel === 'search' ? null : 'search')}>
            <Search size={20} />
          </IconButton>
          <IconButton label={here ? 'Remove bookmark here' : 'Bookmark this place'} pressed={!!here} onClick={toggleBookmark} disabled={readOnly}>
            {here ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
          </IconButton>
          <IconButton label="Text settings" pressed={panel === 'type'} onClick={() => setPanel(panel === 'type' ? null : 'type')}>
            <Type size={20} />
          </IconButton>
          {onStudy && (
            <IconButton label="Study with notebook" onClick={onStudy}>
              <NotebookPen size={20} />
            </IconButton>
          )}
          <Menu
            label="More"
            trigger={<MoreHorizontal size={20} />}
            items={[
              { label: 'Bookmarks', icon: <Bookmark size={16} />, onSelect: () => setPanel('bookmarks') },
              { label: paged ? 'Scroll instead of pages' : 'Turn pages instead of scrolling', onSelect: () => setTypo({ layout: paged ? 'scroll' : 'paged' }) },
              'sep',
              { label: 'Download original EPUB', onSelect: () => void downloadOriginal(book).catch((e) => toast({ kind: 'error', message: errorMessage(e) })) },
            ]}
          />
        </header>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={view}
          className={cx('absolute inset-0', paged ? 'overflow-hidden' : 'overflow-y-auto')}
          style={{ paddingInline: paged ? margin : 0, touchAction: paged ? 'pan-y pinch-zoom' : 'pan-y pinch-zoom' }}
          onScroll={paged ? undefined : (e) => {
            const v = e.currentTarget;
            scheduleSave();
            setAtEnd(v.scrollTop + v.clientHeight >= v.scrollHeight - 8);
            setScrollFrac(Math.min(1, v.scrollTop / Math.max(1, v.scrollHeight - v.clientHeight)));
          }}
          onPointerDown={(e) => {
            if (e.pointerType === 'touch' && paged) swipe.current = { x: e.clientX, y: e.clientY, t: performance.now() };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - s.t < 800) (dx < 0 !== rtl ? next : prev)();
          }}
        >
          <div
            ref={content}
            lang={handle.book.meta.language || undefined}
            dir={rtl ? 'rtl' : undefined}
            data-testid="epub-content"
            className={cx('epub-content', typo.justify && 'epub-justify', !reducedMotion && paged && 'epub-turn')}
            onClick={onContentClick}
            onKeyDown={onKeyActivate}
            style={{
              fontFamily,
              fontSize: `${(typo.size / 100) * 1.125}rem`,
              lineHeight: typo.lineHeight,
              ...(paged
                ? {
                    height: box.h,
                    columnWidth: colW,
                    columnGap: GAP_FACTOR * margin,
                    columnFill: 'auto',
                    paddingBlock: 32,
                    transform: `translateX(${translate}px)`,
                  }
                : { maxWidth: '42rem', marginInline: 'auto', padding: `40px ${margin}px 96px` }),
            }}
          />
        </div>
        {paged && (
          <>
            <button type="button" aria-label="Previous page" className="sr-only-focusable absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-surface p-2 shadow" onClick={rtl ? next : prev}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" aria-label="Next page" className="sr-only-focusable absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-surface p-2 shadow" onClick={rtl ? prev : next}>
              <ChevronRight size={20} />
            </button>
          </>
        )}

        {panel === 'toc' && (
          <SidePanel title="Contents" onClose={() => setPanel(null)}>
            {handle.book.toc.length === 0 && <p className="p-4 text-sm text-muted">This EPUB has no table of contents.</p>}
            <ul className="p-2">
              {handle.book.toc.map((t, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={cx('w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2', t.spineIndex === spine && 'font-semibold text-accent')}
                    style={{ paddingInlineStart: 12 + t.depth * 16 }}
                    onClick={() => {
                      goChapter(t.spineIndex, { fragment: t.fragment });
                      if (box.w < 900) setPanel(null);
                    }}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </SidePanel>
        )}
        {panel === 'search' && (
          <SidePanel title="Search" onClose={() => setPanel(null)}>
            <form
              className="flex gap-2 p-3"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch(new FormData(e.currentTarget).get('q') as string);
              }}
            >
              <label className="sr-only" htmlFor="epub-search">
                Search in book
              </label>
              <input id="epub-search" name="q" type="search" defaultValue={search.query} placeholder="Search text" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" autoFocus />
              <Button type="submit" variant="primary">
                Find
              </Button>
            </form>
            <div className="flex items-center gap-1 px-3 pb-2 text-sm text-muted" data-testid="epub-search-status" aria-live="polite">
              <span className="flex-1">{search.query ? (search.hits.length ? `Match ${search.active + 1} of ${search.hits.length}` : 'No matches') : 'Type at least 2 characters.'}</span>
              <IconButton label="Previous match" disabled={search.active <= 0} onClick={() => goHit(search.active - 1)}>
                <ChevronUp size={18} />
              </IconButton>
              <IconButton label="Next match" disabled={search.active < 0 || search.active >= search.hits.length - 1} onClick={() => goHit(search.active + 1)}>
                <ChevronDown size={18} />
              </IconButton>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {search.hits.slice(0, 200).map((h, i) => (
                <li key={i}>
                  <button type="button" className={cx('w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2', i === search.active && 'bg-accent-soft')} onClick={() => goHit(i)}>
                    <span className="block text-xs text-muted">Section {h.spineIndex + 1}</span>…{h.snippet}…
                  </button>
                </li>
              ))}
            </ul>
          </SidePanel>
        )}
        {panel === 'bookmarks' && (
          <SidePanel title="Bookmarks" onClose={() => setPanel(null)}>
            {bookmarks.length === 0 && <p className="p-4 text-sm text-muted">No bookmarks yet.</p>}
            <ul className="p-2">
              {bookmarks
                .filter((b) => b.location.kind === 'epub')
                .sort((a, b) => (a.location as EpubLocation).spineIndex - (b.location as EpubLocation).spineIndex || (a.location as EpubLocation).fraction - (b.location as EpubLocation).fraction)
                .map((b) => (
                  <li key={b.id} className="flex items-center gap-1">
                    <button type="button" className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => goChapter((b.location as EpubLocation).spineIndex, { fraction: (b.location as EpubLocation).fraction })}>
                      {b.label}
                    </button>
                    <IconButton label={`Remove bookmark ${b.label}`} disabled={readOnly} onClick={() => void BookmarkRepository.remove(b.id)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </li>
                ))}
            </ul>
          </SidePanel>
        )}
        {panel === 'type' && <TypographyPanel typo={typo} onChange={setTypo} theme={settings.theme} onTheme={setTheme} onClose={() => setPanel(null)} />}
      </div>

      {showChrome && (
        <footer className="safe-pb z-20 flex items-center gap-3 border-t border-line bg-surface/95 px-3 py-2 text-xs text-muted backdrop-blur">
          <span className="min-w-0 flex-1 truncate">{chapterTitle}</span>
          <label className="sr-only" htmlFor="epub-scrub">
            Section
          </label>
          <input
            id="epub-scrub"
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            value={spine}
            onChange={(e) => goChapter(Number(e.target.value))}
            className="hidden w-40 accent-[var(--color-accent)] sm:block"
            dir={rtl ? 'rtl' : 'ltr'}
          />
          <span className="whitespace-nowrap tabular-nums" data-testid="epub-page-indicator">
            {paged ? `Page ${page + 1} of ${pageCount} · ` : ''}Section {spine + 1} of {n} · {bookProgress}%
          </span>
        </footer>
      )}

      <Dialog
        open={external !== null}
        onClose={() => setExternal(null)}
        title="Open external link?"
        footer={
          <>
            <Button onClick={() => setExternal(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<ExternalLink size={16} />}
              onClick={() => {
                if (external) window.open(external, '_blank', 'noopener,noreferrer');
                setExternal(null);
              }}
            >
              Open link
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm">This link leaves Folio and opens a website in a new tab:</p>
        <p className="break-all rounded-lg bg-surface-2 p-2 font-mono text-xs">{external}</p>
      </Dialog>
    </div>
  );
}

function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside
      aria-label={title}
      data-testid="epub-panel"
      className="absolute inset-y-0 left-0 z-30 flex w-[min(340px,100%)] flex-col border-r border-line bg-surface shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </aside>
  );
}

function Segmented<T extends string | number | boolean>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="px-4 py-2">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</legend>
      <div className="flex rounded-xl bg-surface-2 p-1">
        {options.map(([v, l]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            className={cx('min-h-10 flex-1 rounded-lg px-2 text-sm', value === v ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-muted')}
            onClick={() => onChange(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TypographyPanel({ typo, onChange, theme, onTheme, onClose }: { typo: EpubTypography; onChange: (p: Partial<EpubTypography>) => void; theme: ThemePref; onTheme: (t: ThemePref) => void; onClose: () => void }) {
  return (
    <aside
      aria-label="Text settings"
      data-testid="epub-type-panel"
      className="absolute right-2 top-2 z-30 max-h-[calc(100%-16px)] w-[min(340px,calc(100%-16px))] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface py-2 shadow-xl"
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
    >
      <div className="flex items-center justify-between px-4 pb-1">
        <h2 className="text-sm font-semibold">Text settings</h2>
        <IconButton label="Close text settings" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="flex-1 text-xs font-medium uppercase tracking-wide text-muted">Size</span>
        <IconButton label="Smaller text" disabled={typo.size <= 80} onClick={() => onChange({ size: typo.size - 10 })}>
          <span className="text-sm font-semibold">A</span>
        </IconButton>
        <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">
          {typo.size}%
        </span>
        <IconButton label="Larger text" disabled={typo.size >= 200} onClick={() => onChange({ size: typo.size + 10 })}>
          <span className="text-xl font-semibold">A</span>
        </IconButton>
      </div>
      <Segmented label="Font" value={typo.font} options={[['serif', 'Serif'], ['sans', 'Sans']]} onChange={(font) => onChange({ font })} />
      <Segmented label="Line spacing" value={typo.lineHeight} options={[[1.3, 'Tight'], [1.6, 'Normal'], [1.9, 'Loose']]} onChange={(lineHeight) => onChange({ lineHeight })} />
      <Segmented label="Margins" value={typo.margin} options={[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]} onChange={(margin) => onChange({ margin })} />
      <Segmented label="Alignment" value={typo.justify} options={[[true, 'Justified'], [false, 'Left']]} onChange={(justify) => onChange({ justify })} />
      <Segmented label="Layout" value={typo.layout} options={[['paged', 'Pages'], ['scroll', 'Scroll']]} onChange={(layout) => onChange({ layout })} />
      <Segmented label="Theme" value={theme} options={[['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark'], ['system', 'Auto']]} onChange={onTheme} />
    </aside>
  );
}

/** Wrap case-insensitive matches inside single text nodes with <mark>. */
function highlight(root: HTMLElement, query: string) {
  if (!query) return;
  const needle = query.toLocaleLowerCase();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const hay = text.toLocaleLowerCase();
    let at = hay.indexOf(needle);
    if (at < 0) continue;
    const frag = root.ownerDocument.createDocumentFragment();
    let from = 0;
    while (at >= 0) {
      frag.append(text.slice(from, at));
      const m = root.ownerDocument.createElement('mark');
      m.className = 'folio-hit';
      m.textContent = text.slice(at, at + needle.length);
      frag.append(m);
      from = at + needle.length;
      at = hay.indexOf(needle, from);
    }
    frag.append(text.slice(from));
    node.replaceWith(frag);
  }
}
