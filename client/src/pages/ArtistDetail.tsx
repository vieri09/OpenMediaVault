import { useParams } from 'react-router-dom';
import { Play, Shuffle } from 'lucide-react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { ArtistDetail as ArtistDetailType } from '../types.ts';
import { AlbumGrid } from '../components/Grids.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Loading } from '../components/common.tsx';
import { usePlayer } from '../stores/player.ts';
import { plural, formatDuration } from '../lib/format.ts';

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: artist, error } = useSWR<ArtistDetailType>(`/api/artists/${id}`, () => api.artistDetail(id!));
  const playTracks = usePlayer((s) => s.playTracks);

  if (error) return <div className="error">Artist not found.</div>;
  if (!artist) return <Loading />;

  const allTracks = artist.tracks;
  const playAll = (): void => playTracks(allTracks, 0);
  const shuffle = (): void => {
    const player = usePlayer.getState();
    player.playTracks(allTracks, 0);
    if (!player.shuffle) player.toggleShuffle();
  };

  const initial = artist.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="content">
      <div className="detail-header">
        <div className="detail-cover-fallback" style={{ borderRadius: '50%', fontSize: 80, fontWeight: 800 }}>
          {initial}
        </div>
        <div className="detail-meta">
          <div className="label">Artist</div>
          <h1>{artist.name}</h1>
          <div style={{ color: 'var(--text-muted)' }}>
            {plural(artist.trackCount, 'song')} · {plural(artist.albumCount, 'album')} · {formatDuration(artist.duration)}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={playAll}>
          <Play size={16} fill="currentColor" /> Play all
        </button>
        <button className="btn btn-ghost" onClick={shuffle}>
          <Shuffle size={16} /> Shuffle
        </button>
      </div>

      {artist.albums.length > 0 && (
        <>
          <h2 className="section-title">Albums</h2>
          <AlbumGrid albums={artist.albums} />
        </>
      )}

      <h2 className="section-title">All songs</h2>
      <TrackList tracks={allTracks} showAlbum />
    </div>
  );
}
