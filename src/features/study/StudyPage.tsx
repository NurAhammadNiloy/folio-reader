import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, BookOpen, NotebookPen, PanelLeftClose, PanelRightClose, Columns2, Plus } from 'lucide-react';
import { getDb } from '../../core/storage/db';
import { NotebookRepository } from '../../core/storage/notebookRepository';
import { ReaderScreen } from '../reader/ReaderScreen';
import { createReaderStore, useReader } from '../reader/readerStore';
import { NotebookPane, useBookTitles } from './NotebookPane';
import { Button, IconButton, cx } from '../../components/ui';
import { errorMessage, useApp } from '../../app/appStore';

function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 639px)');
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

export default function StudyPage() {
  const { bookId = '' } = useParams();
  return <Study key={bookId} bookId={bookId} />;
}

function Study({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [store] = useState(createReaderStore);
  const toast = useApp((s) => s.toast);
  const readOnly = useApp((s) => s.lease !== 'owner');
  const book = useLiveQuery(() => getDb().books.get(bookId), [bookId]);
  const notebooks = useLiveQuery(() => NotebookRepository.forBook(bookId), [bookId]);
  const titles = useBookTitles();
  const current = useReader(store, (s) => s.current);
  const currentLabel = useReader(store, (s) => s.label(s.current));
  const phone = useIsPhone();
  const [tab, setTab] = useState<'book' | 'notes'>('book');
  const [split, setSplit] = useState(55);
  const [collapsed, setCollapsed] = useState<null | 'book' | 'notes'>(null);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const selectedId = params.get('notebook');
  const notebook = notebooks?.find((n) => n.id === selectedId) ?? notebooks?.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];

  // Jump to a requested page (e.g. from Notes view).
  useEffect(() => {
    const p = params.get('page');
    if (p !== null) setTimeout(() => store.getState().goTo(Number(p)), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createNotebook = async () => {
    try {
      const nb = await NotebookRepository.create(`${book?.title ?? 'Book'} notes`, bookId);
      setParams({ notebook: nb.id }, { replace: true });
    } catch (e) {
      toast({ kind: 'error', message: errorMessage(e) });
    }
  };

  const notesPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-2 py-1">
        <NotebookPen size={16} className="text-accent" aria-hidden />
        {notebooks && notebooks.length > 0 ? (
          <>
            <label htmlFor="nb-select" className="sr-only">
              Notebook
            </label>
            <select
              id="nb-select"
              value={notebook?.id ?? ''}
              onChange={(e) => setParams({ notebook: e.target.value }, { replace: true })}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-2 text-sm"
            >
              {notebooks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
            <IconButton label="New notebook" onClick={() => void createNotebook()} disabled={readOnly}>
              <Plus size={18} />
            </IconButton>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted">Notebook</span>
        )}
      </div>
      {notebooks === undefined ? null : notebook ? (
        <div className="min-h-0 flex-1">
          <NotebookPane
            key={notebook.id}
            notebook={notebook}
            currentBookPage={current}
            currentBookLabel={currentLabel}
            bookTitles={titles}
            onJump={(id, page) => {
              if (id === bookId) {
                store.getState().goTo(page);
                if (phone) setTab('book');
              } else navigate(`/reader/${id}`);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted">Take handwritten or typed notes next to this book. Notebook pages can link to book pages.</p>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => void createNotebook()} disabled={readOnly}>
            Create a notebook
          </Button>
        </div>
      )}
    </div>
  );

  const reader = <ReaderScreen bookId={bookId} store={store} embedded />;

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="safe-pt flex items-center gap-1 border-b border-line bg-surface px-2 py-1">
        <IconButton label="Back to library" onClick={() => navigate('/')}>
          <ArrowLeft size={20} />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">Study · {book?.title ?? ''}</h1>
        {phone ? (
          <div role="tablist" aria-label="Study view" className="flex">
            <button role="tab" aria-selected={tab === 'book'} onClick={() => setTab('book')} className={cx('inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm', tab === 'book' && 'bg-accent-soft text-accent')}>
              <BookOpen size={16} aria-hidden /> Book
            </button>
            <button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')} className={cx('inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm', tab === 'notes' && 'bg-accent-soft text-accent')}>
              <NotebookPen size={16} aria-hidden /> Notebook
            </button>
          </div>
        ) : (
          <div className="flex">
            <IconButton label="Hide book pane" pressed={collapsed === 'book'} onClick={() => setCollapsed(collapsed === 'book' ? null : 'book')}>
              <PanelLeftClose size={18} />
            </IconButton>
            <IconButton label="Show both panes" pressed={collapsed === null} onClick={() => setCollapsed(null)}>
              <Columns2 size={18} />
            </IconButton>
            <IconButton label="Hide notebook pane" pressed={collapsed === 'notes'} onClick={() => setCollapsed(collapsed === 'notes' ? null : 'notes')}>
              <PanelRightClose size={18} />
            </IconButton>
          </div>
        )}
      </header>
      {phone ? (
        <div className="min-h-0 flex-1">
          <div className={cx('h-full', tab !== 'book' && 'hidden')}>{reader}</div>
          <div className={cx('h-full', tab !== 'notes' && 'hidden')}>{notesPane}</div>
        </div>
      ) : (
        <div
          ref={container}
          className="flex min-h-0 flex-1"
          onPointerMove={(e) => {
            if (!dragging.current || !container.current) return;
            const r = container.current.getBoundingClientRect();
            setSplit(Math.min(80, Math.max(20, ((e.clientX - r.left) / r.width) * 100)));
          }}
          onPointerUp={() => (dragging.current = false)}
        >
          <div className={cx('min-w-0', collapsed === 'book' && 'hidden')} style={{ width: collapsed === 'notes' ? '100%' : `${split}%` }}>
            {reader}
          </div>
          {collapsed === null && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize book and notebook panes"
              aria-valuenow={Math.round(split)}
              aria-valuemin={20}
              aria-valuemax={80}
              tabIndex={0}
              onPointerDown={(e) => {
                dragging.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerUp={() => (dragging.current = false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setSplit((s) => Math.max(20, s - 5));
                if (e.key === 'ArrowRight') setSplit((s) => Math.min(80, s + 5));
              }}
              className="w-3 flex-none cursor-col-resize touch-none bg-line/60 hover:bg-accent/40"
            />
          )}
          <div className={cx('min-w-0 flex-1', collapsed === 'notes' && 'hidden')}>{notesPane}</div>
        </div>
      )}
    </div>
  );
}

