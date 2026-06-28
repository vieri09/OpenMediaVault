import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { SearchResult } from '../types.ts';
import { TrackList } from '../components/TrackList.tsx';
import { AlbumGrid, ArtistGrid } from '../components/Grids.tsx';
import { PageHeader } from '../components/common.tsx';

type Tab = 'all' | 'tracks' | 'albums' | 'artists';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [tab, setTab] = useState<Tab>('all');

  const { data, error, isValidating } = useSWR<SearchResult>(
    q ? `/api/search?q=${encodeURIComponent(q)}&limit=40` : null,
    () => api.search(q, 40),
  );

  // Keep the input in sync with the URL.
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setParams(text.trim() ? { q: text.trim() } : {});
  };

  const empty =
    !!data &&
    data.tracks.length === 0 &&
    data.albums.length === 0 &&
    data.artists.length === 0;

  return (
    <div className="content">
      <PageHeader title="Search">
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            className="input search-input"
            placeholder="Search songs, albums, artists…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button className="btn" type="submit">Search</button>
        </form>
      </PageHeader>

      {!q ? (
        <div className="empty-state">Type to search your library.</div>
      ) : error ? (
        <div className="error">Search failed.</div>
      ) : !data ? (
        isValidating ? <div className="loading">Searching…</div> : null
      ) : empty ? (
        <div className="empty-state">No results for “{q}”.</div>
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 20 }}>
            {(['all', 'tracks', 'albums', 'artists'] as Tab[]).map((t) => (
              <button
                key={t}
                className={`chip ${tab === t ? '' : ''}`}
                style={tab === t ? { background: 'var(--bg-active)', color: 'var(--text)' } : undefined}
                onClick={() => setTab(t)}
              >
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {(tab === 'all' || tab === 'tracks') && data.tracks.length > 0 && (
            <>
              {tab === 'all' && <h2 className="section-title">Tracks</h2>}
              <TrackList tracks={data.tracks} showAlbum />
            </>
          )}
          {(tab === 'all' || tab === 'albums') && data.albums.length > 0 && (
            <>
              {tab === 'all' && <h2 className="section-title">Albums</h2>}
              <AlbumGrid albums={data.albums} />
            </>
          )}
          {(tab === 'all' || tab === 'artists') && data.artists.length > 0 && (
            <>
              {tab === 'all' && <h2 className="section-title">Artists</h2>}
              <ArtistGrid artists={data.artists} />
            </>
          )}
        </>
      )}
    </div>
  );
}
