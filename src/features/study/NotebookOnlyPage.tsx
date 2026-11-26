import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { NotebookRepository } from '../../core/storage/notebookRepository';
import { NotebookPane, useBookTitles } from './NotebookPane';
import { IconButton } from '../../components/ui';

export default function NotebookOnlyPage() {
  const { notebookId = '' } = useParams();
  const navigate = useNavigate();
  const nb = useLiveQuery(() => NotebookRepository.get(notebookId), [notebookId]);
  const titles = useBookTitles();
  return (
    <div className="flex h-dvh flex-col">
      <header className="safe-pt flex items-center gap-1 border-b border-line bg-surface px-2 py-1">
        <IconButton label="Back to notes" onClick={() => navigate('/notes')}>
          <ArrowLeft size={20} />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{nb?.title ?? 'Notebook'}</h1>
      </header>
      <div className="min-h-0 flex-1">
        {nb === undefined ? null : nb === null ? (
          <p className="p-6 text-muted">Notebook not found.</p>
        ) : (
          <NotebookPane notebook={nb} currentBookPage={null} bookTitles={titles} onJump={(bookId, page) => navigate(`/study/${bookId}?notebook=${nb.id}&page=${page}`)} />
        )}
      </div>
    </div>
  );
}
