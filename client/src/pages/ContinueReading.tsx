import useSWR from 'swr';
import { continueReading } from '../api.ts';
import { Loading, PageHeader } from '../components/common.tsx';
import { BookGrid } from '../components/BookCard.tsx';

export default function ContinueReading() {
  const { data, error } = useSWR('/api/books/continue?limit=50', () =>
    continueReading(50),
  );

  return (
    <div className="content movies-content">
      <PageHeader
        title="Continue Reading"
        subtitle="Pick up where you left off"
      />
      {error ? (
        <div className="error">Could not load reading progress.</div>
      ) : !data ? (
        <Loading />
      ) : data.length > 0 ? (
        <BookGrid books={data} />
      ) : (
        <div className="empty-state">
          <h2>Nothing in progress</h2>
          <p className="muted">Books you start reading will appear here.</p>
        </div>
      )}
    </div>
  );
}
