import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReaderScreen } from './ReaderScreen';
import { createReaderStore } from './readerStore';

export default function ReaderPage() {
  const { bookId = '' } = useParams();
  return <ReaderRoute key={bookId} bookId={bookId} />;
}

function ReaderRoute({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const [store] = useState(createReaderStore);
  return (
    <div className="h-dvh">
      <ReaderScreen bookId={bookId} store={store} onBack={() => navigate('/')} onStudy={() => navigate(`/study/${bookId}`)} />
    </div>
  );
}
