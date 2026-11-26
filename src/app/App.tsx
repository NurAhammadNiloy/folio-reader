import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './Shell';
import { LibraryPage } from '../features/library/LibraryPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { NotesPage } from '../features/notes/NotesPage';
import { Toasts } from './Toasts';
import { Spinner } from '../components/ui';
import { NotFound } from './NotFound';

const ReaderPage = lazy(() => import('../features/reader/ReaderPage'));
const StudyPage = lazy(() => import('../features/study/StudyPage'));
const NotebookOnlyPage = lazy(() => import('../features/study/NotebookOnlyPage'));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<LibraryPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="reader/:bookId" element={<ReaderPage />} />
          <Route path="study/:bookId" element={<StudyPage />} />
          <Route path="notes/:notebookId" element={<NotebookOnlyPage />} />
        </Routes>
      </Suspense>
      <Toasts />
    </HashRouter>
  );
}
