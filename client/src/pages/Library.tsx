import { useNavigate } from 'react-router-dom';
import { Shuffle, Heart, Clock, Disc3 } from 'lucide-react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { LibrarySummary } from '../types.ts';
import { usePlayer } from '../stores/player.ts';
import { useLibrary } from '../stores/library.ts';
import { AlbumGrid } from '../components/Grids.tsx';
import { PageHeader, Loading } from '../components/common.tsx';
import { formatDuration, plural } from '../lib/format.ts';
import { coverUrl } from '../api.ts';

export default function Library() {
  const navigate = useNavigate();
  const { data: summary, error } = useSWR<LibrarySummary>('/api/library/summary', api.summary);
  const { data: recent } = useSWR('/api/albums/recent?limit=18', () => api.albums({ sort: 'recently_added', order: 'desc', limit: 18 }));
  const recentlyPlayed = useLibrary((s) => s.recentlyPlayed);
  const favorites = useLibrary((s) => s.favorites);

  if (error) return <div className="error">Could not load library.</div>;
  if (!summary) return <Loading />;

  if (!summary.configured || summary.trackCount === 0) {
    return (
      <div className="content">
        <div className="empty-state">
          <h2>Your library is empty</h2>
          <p className="muted">
            Point OpenMedia at your music folder, then run a rescan.
          </p>
          <p className="muted" style={{ marginTop: 16, fontFamily: 'var(--mono)', fontSize: 12 }}>
            MUSIC_LIBRARY_PATH={summary.libraryPath || '/path/to/music'}
          </p>
          <p className="muted">Edit <code>.env</code> at the project root, restart, and press “Rescan Library” in the sidebar.</p>
        </div>
      </div>
    );
  }

  const playShuffleAll = async (): Promise<void> => {
    const res = await api.tracks({ limit: 500 });
    const player = usePlayer.getState();
    player.playTracks(res.items);
    player.toggleShuffle(); // ensure shuffle
    if (!player.isPlaying) player.togglePlay();
  };

  return (
    <div className="content">
      <PageHeader
        title="Library"
        subtitle={`${plural(summary.trackCount, 'song')} · ${plural(summary.albumCount, 'album')} · ${plural(summary.artistCount, 'artist')} · ${formatDuration(summary.totalDurationSeconds)}`}
      >
        <button className="btn btn-primary" onClick={playShuffleAll}>
          <Shuffle size={16} /> Shuffle all
        </button>
      </PageHeader>

      <h2 className="section-title">Recently added</h2>
      {recent ? <AlbumGrid albums={recent.items} /> : <Loading />}

      {recentlyPlayed.length > 0 && (
        <>
          <h2 className="section-title">Recently played</h2>
          <div className="grid">
            {recentlyPlayed.slice(0, 12).map((t) => (
              <button
                key={t.id}
                className="card"
                style={{ textAlign: 'left', background: 'none', border: 'none' }}
                onClick={() => usePlayer.getState().playTrack(t)}
                title={`Play ${t.title}`}
              >
                <div className="card-cover">
                  {t.hasCover ? (
                    <img src={coverUrl(t.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                  ) : (
                    <div className="cover-fallback"><Disc3 size={26} /></div>
                  )}
                  <span className="card-play"><Shuffle size={16} fill="currentColor" /></span>
                </div>
                <p className="card-title">{t.title}</p>
                <p className="card-meta">{t.artist}</p>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">Quick links</h2>
      <div className="chips">
        <button className="chip" onClick={() => navigate('/songs')}>
          <Clock size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} /> All songs
        </button>
        <button className="chip" onClick={() => navigate('/albums')}>
          <Disc3 size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} /> All albums
        </button>
        <span className="chip" style={{ cursor: 'default' }}>
          <Heart size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} /> {plural(favorites.length, 'favorite')}
        </span>
      </div>
    </div>
  );
}
