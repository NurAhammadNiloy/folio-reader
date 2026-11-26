import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileX2, Lock } from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { BookmarkRepository } from '../../core/storage/bookmarkRepository';
import { ProgressRepository } from '../../core/storage/progressRepository';
import { SettingsRepository } from '../../core/storage/settingsRepository';
import { Button, Dialog, Spinner, TextField } from '../../components/ui';
import { errorMessage, useApp } from '../../app/appStore';
import { prefersReducedMotion } from '../../app/theme';
import { useReaderDocument } from './useReaderDocument';
import { ReaderView, type Visibility } from './ReaderView';
import { BottomBar, InkBar, TopBar } from './Toolbars';
import { BookmarksPanel, OutlinePanel, SearchPanel, ThumbsPanel } from './Panels';
import { useReader, type ReaderStore } from './readerStore';
import { useReadingTracking } from './useReadingTracking';
import { useBookInk } from '../ink/useBookInk';
import { downloadOriginal, exportAnnotated } from '../export/bookActions';
import type { BookRecord, ReadingProgressRecord } from '../../core/storage/types';
import type { OpenedPdf } from '../../core/documents/pdfEngine';

export function ReaderScreen({
  bookId,
  store,
  onBack,
  onStudy,
  embedded,
}: {
  bookId: string;
  store: ReaderStore;
  onBack?: () => void;
  onStudy?: () => void;
  embedded?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const doc = useReaderDocument(bookId, store, attempt);

  if (doc.kind === 'loading')
    return (
      <div className="flex h-full items-center justify-center bg-[var(--reader-bg)]">
        <Spinner label="Opening book…" />
      </div>
    );
  if (doc.kind === 'not-found')
    return <StateMessage icon={<FileX2 />} title="Book not found" body="This book is not in your library on this device. It may have been deleted or this link came from another browser." />;
  if (doc.kind === 'missing-file')
    return (
      <StateMessage
        icon={<FileX2 />}
        title="The PDF file is missing"
        body={`Folio has the details for “${doc.book.title}” but not its file. Re-import the PDF from the library or restore a backup.`}
      />
    );
  if (doc.kind === 'corrupt')
    return (
      <StateMessage
        icon={<AlertTriangle />}
        title="This PDF could not be opened"
        body={`“${doc.book.title}” appears damaged or uses features Folio cannot read. ${doc.detail} You can download the stored original or re-import a fresh copy.`}
        action={<Button onClick={() => void downloadOriginal(doc.book).catch(() => undefined)}>Download stored original</Button>}
      />
    );
  if (doc.kind === 'password') return <PasswordGate book={doc.book} reason={doc.reason} submit={doc.submit} />;
  if (doc.kind === 'cancelled')
    return (
      <StateMessage
        icon={<Lock />}
        title="Password required"
        body="This PDF is password-protected. Folio never stores the password, so it asks each time you open the book."
        action={<Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>Enter password</Button>}
      />
    );
  return <ReadyReader key={attempt} book={doc.book} pdf={doc.pdf} progress={doc.progress} store={store} onBack={onBack} onStudy={onStudy} embedded={embedded} />;
}

function StateMessage({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center" role="alert">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-accent">{icon}</div>
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="mb-4 text-sm text-muted">{body}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {action}
          <Link to="/" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-medium hover:bg-surface-2">
            Back to library
          </Link>
        </div>
      </div>
    </div>
  );
}

function PasswordGate({ book, reason, submit }: { book: BookRecord; reason: 'required' | 'incorrect'; submit: (pw: string | null) => void }) {
  const [pw, setPw] = useState('');
  return (
    <Dialog
      open
      onClose={() => submit(null)}
      title="Password required"
      footer={
        <>
          <Button onClick={() => submit(null)}>Cancel</Button>
          <Button variant="primary" type="submit" form="reader-pw" disabled={!pw}>
            Open
          </Button>
        </>
      }
    >
      <form
        id="reader-pw"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) submit(pw);
        }}
      >
        <p className="mb-3">
          “{book.title}” is password-protected.
          {reason === 'incorrect' && <strong className="block text-danger">That password was not correct.</strong>}
        </p>
        <TextField label="Password" type="password" value={pw} onChange={setPw} autoFocus hint="The password is kept only in memory while the book is open." />
      </form>
    </Dialog>
  );
}

function ReadyReader({
  book,
  pdf,
  progress,
  store,
  onBack,
  onStudy,
  embedded,
}: {
  book: BookRecord;
  pdf: OpenedPdf;
  progress: ReadingProgressRecord;
  store: ReaderStore;
  onBack?: () => void;
  onStudy?: () => void;
  embedded?: boolean;
}) {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const toast = useApp((s) => s.toast);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const ink = useBookInk(book.id);
  const visibilityRef = useRef<Visibility>({ pages: new Map(), viewportArea: 0 });
  const panel = useReader(store, (s) => s.panel);
  const chrome = useReader(store, (s) => s.chrome);
  const tool = useReader(store, (s) => s.tool);
  const current = useReader(store, (s) => s.current);
  const direction = useReader(store, (s) => s.direction);
  const coverAlone = useReader(store, (s) => s.coverAlone);
  const bookmarks = useLiveQuery(() => getDb().bookmarks.where('bookId').equals(book.id).toArray(), [book.id]) ?? [];
  const pageBookmark = bookmarks.find((b) => b.location.kind === 'pdf' && b.location.pageIndex === current);
  const reducedMotion = prefersReducedMotion(settings);

  // Restore last location once.
  useEffect(() => {
    const loc = progress.lastLocation;
    if (loc?.kind === 'pdf') store.getState().goTo(loc.pageIndex, loc.yFraction);
    else store.getState().goTo(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist viewer preferences separately from location.
  const prefsKey = useReader(store, (s) => `${s.viewMode}|${s.zoomMode}|${s.zoom}|${s.rotation}|${s.coverAlone}`);
  const firstPrefs = useRef(true);
  useEffect(() => {
    if (firstPrefs.current) {
      firstPrefs.current = false;
      return;
    }
    const t = setTimeout(() => void ProgressRepository.savePrefs(book.id, store.getState().prefs()).catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, [prefsKey, book.id, store]);

  useReadingTracking(book.id, visibilityRef, { qualifySeconds: settings.qualifySeconds, idleSeconds: settings.idleSeconds, enabled: !readOnly });

  // Leave drawing mode if the tab becomes read-only.
  useEffect(() => {
    if (readOnly && store.getState().tool !== 'read') store.getState().set({ tool: 'read' });
  }, [readOnly, store]);

  const toggleBookmark = useCallback(() => {
    const fail = (e: unknown) => toast({ kind: 'error', message: errorMessage(e) });
    if (pageBookmark) void BookmarkRepository.remove(pageBookmark.id).catch(fail);
    else void BookmarkRepository.add(book.id, { kind: 'pdf', pageIndex: current, xFraction: 0, yFraction: 0 }, `Page ${store.getState().label(current)}`).catch(fail);
  }, [pageBookmark, book.id, current, store, toast]);

  // Keyboard shortcuts (non-gesture alternatives).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      const st = store.getState();
      const rtl = st.direction === 'rtl';
      const fwd = () => st.next();
      const back = () => st.prev();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        st.set({ panel: 'search' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? ink.redo() : ink.undo());
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const scale = (store as unknown as { effectiveScale?: number }).effectiveScale ?? 1;
      switch (e.key) {
        case 'ArrowRight':
          if (st.viewMode !== 'scroll') (rtl ? back : fwd)();
          break;
        case 'ArrowLeft':
          if (st.viewMode !== 'scroll') (rtl ? fwd : back)();
          break;
        case 'PageDown':
          if (st.viewMode !== 'scroll') {
            e.preventDefault();
            fwd();
          }
          break;
        case 'PageUp':
          if (st.viewMode !== 'scroll') {
            e.preventDefault();
            back();
          }
          break;
        case 'Home':
          st.goTo(0);
          break;
        case 'End':
          st.goTo(st.numPages - 1);
          break;
        case '+':
        case '=':
          st.zoomBy(1.2, scale);
          break;
        case '-':
          st.zoomBy(1 / 1.2, scale);
          break;
        case '0':
          st.set({ zoomMode: 'fitPage' });
          break;
        case 'Escape':
          if (st.panel) st.set({ panel: null });
          else if (st.tool !== 'read') st.set({ tool: 'read' });
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, ink]);

  const setFingerDraws = (v: boolean) => {
    patchSettings({ fingerInDrawMode: v ? 'draw' : 'navigate' });
    void SettingsRepository.set('fingerInDrawMode', v ? 'draw' : 'navigate').catch(() => undefined);
  };

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => toast({ kind: 'error', message: errorMessage(e) }));
  const showChrome = chrome || tool !== 'read' || !!panel;

  return (
    <div className="flex h-full flex-col bg-[var(--reader-bg)]" data-testid="reader">
      {showChrome && (
        <TopBar
          book={book}
          store={store}
          onBack={onBack}
          embedded={embedded}
          onStudy={onStudy}
          readOnly={readOnly}
          bookmarked={!!pageBookmark}
          onToggleBookmark={toggleBookmark}
          moreItems={[
            { label: 'Download original PDF', onSelect: () => run(() => downloadOriginal(book)) },
            {
              label: book.encrypted ? 'Annotated export unavailable (encrypted PDF)' : 'Export annotated PDF',
              disabled: book.encrypted,
              onSelect: () =>
                run(async () => {
                  const { marks } = await exportAnnotated(book);
                  toast({ kind: 'success', message: `Exported a copy with ${marks} marks. The original is unchanged.` });
                }),
            },
            { label: direction === 'rtl' ? 'Reading direction: right to left' : 'Reading direction: left to right', onSelect: () => run(() => toggleDirection(book, store)) },
            { label: coverAlone ? 'Spread: show first page with page 2' : 'Spread: show first page alone', onSelect: () => store.getState().set({ coverAlone: !store.getState().coverAlone }) },
          ]}
        />
      )}
      <InkBar store={store} ink={ink} fingerDraws={settings.fingerInDrawMode === 'draw'} onFingerDraws={setFingerDraws} />
      {ink.checkpoints.length > 0 && !readOnly && (
        <div role="alert" className="z-20 flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft px-3 py-2 text-sm">
          An unfinished stroke from a previous session was recovered.
          <Button onClick={() => void ink.recoverCheckpoint(ink.checkpoints[0]!, true)}>Keep it</Button>
          <Button onClick={() => void ink.recoverCheckpoint(ink.checkpoints[0]!, false)}>Discard</Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <ReaderView
          store={store}
          doc={pdf.doc}
          bookId={book.id}
          ink={ink}
          fingerDraws={settings.fingerInDrawMode === 'draw'}
          reducedMotion={reducedMotion}
          visibilityRef={visibilityRef}
          onToggleChrome={() => store.getState().set({ chrome: !store.getState().chrome })}
        />
        {panel === 'outline' && <OutlinePanel doc={pdf.doc} store={store} onClose={() => store.getState().set({ panel: null })} />}
        {panel === 'thumbs' && <ThumbsPanel doc={pdf.doc} store={store} docKey={book.id} onClose={() => store.getState().set({ panel: null })} />}
        {panel === 'search' && <SearchPanel doc={pdf.doc} store={store} onClose={() => store.getState().set({ panel: null })} />}
        {panel === 'bookmarks' && <BookmarksPanel bookId={book.id} store={store} onClose={() => store.getState().set({ panel: null })} />}
      </div>
      {showChrome && <BottomBar store={store} />}
      {!showChrome && (
        <button className="sr-only-focusable fixed bottom-2 left-2 z-30 rounded-lg bg-surface px-3 py-2 text-sm" onClick={() => store.getState().set({ chrome: true })}>
          Show reader controls
        </button>
      )}
    </div>
  );
}

async function toggleDirection(book: BookRecord, store: ReaderStore) {
  const { LibraryRepository } = await import('../../core/storage/libraryRepository');
  const next = store.getState().direction === 'rtl' ? 'ltr' : 'rtl';
  await LibraryRepository.update(book.id, { direction: next });
  store.getState().set({ direction: next });
}
