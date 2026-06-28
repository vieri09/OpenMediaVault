import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import type { Genre } from '../types.ts';
import { PageHeader, Loading } from '../components/common.tsx';

export default function Genres() {
  const navigate = useNavigate();
  const { data: genres, error } = useSWR<Genre[]>('/api/genres', api.genres);

  const openGenre = (name: string): void => {
    navigate(`/songs?genre=${encodeURIComponent(name)}`);
    // Songs page doesn't filter by query param yet; route to songs for now.
  };

  return (
    <div className="content">
      <PageHeader title="Genres" subtitle={genres ? `${genres.length} genres` : 'Loading…'} />
      {error ? (
        <div className="error">Could not load genres.</div>
      ) : !genres ? (
        <Loading />
      ) : genres.length === 0 ? (
        <div className="empty-state">No genre tags found in your library.</div>
      ) : (
        <div className="chips">
          {genres.map((g) => (
            <button key={g.name} className="chip" onClick={() => openGenre(g.name)}>
              {g.name} · {g.trackCount}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
