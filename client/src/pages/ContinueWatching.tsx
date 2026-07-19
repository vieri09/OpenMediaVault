import useSWR from 'swr';
import { api } from '../api.ts';
import { MovieGrid } from '../components/MovieCard.tsx';
import { Loading, PageHeader } from '../components/common.tsx';

export default function ContinueWatching() {
  const { data, error } = useSWR('/api/movies/continue?limit=50', () =>
    api.continueWatching(50),
  );

  return (
    <div className="content movies-content">
      <PageHeader
        title="Continue Watching"
        subtitle="Pick up where you left off"
      />
      {error ? (
        <div className="error">Could not load playback progress.</div>
      ) : !data ? (
        <Loading />
      ) : data.length > 0 ? (
        <MovieGrid movies={data} />
      ) : (
        <div className="empty-state">
          <h2>Nothing in progress</h2>
          <p className="muted">Movies you partially watch will appear here.</p>
        </div>
      )}
    </div>
  );
}
