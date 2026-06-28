import { useParams, Link } from 'react-router-dom';
import { Play, Shuffle, ListPlus, Clock3 } from 'lucide-react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { AlbumDetail as AlbumDetailType } from '../types.ts';
import { Cover } from '../components/Cover.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { Loading } from '../components/common.tsx';
import { usePlayer } from '../stores/player.ts';
import { formatTime } from '../lib/format.ts';

export default function AlbumDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: album, error } = useSWR<AlbumDetailType>(`/api/albums/${id}`, () => api.albumDetail(id!));
  const playTracks = usePlayer((s) => s.playTracks);
  const addToQueue = usePlayer((s) => s.addToQueue);

  if (error) return <div className="error">Album not found.</div>;
  if (!album) return <Loading />;

  const total = album.tracks.reduce((acc, t) => acc + t.duration, 0);

  const play = (startIndex = 0): void => playTracks(album.tracks, startIndex);
  const shuffle = (): void => {
    const player = usePlayer.getState();
    player.playTracks(album.tracks, 0);
    if (!player.shuffle) player.toggleShuffle();
  };

  return (
    <div className="content">
      <div className="detail-header">
        <Cover coverTrackId={album.coverTrackId} hasCover={album.hasCover} alt={album.title} className="detail-cover" />
        <div className="detail-meta">
          <div className="label">Album</div>
          <h1>{album.title}</h1>
          <div style={{ color: 'var(--text-muted)' }}>
            {album.albumArtist}
            {album.year ? ` · ${album.year}` : ''}
            {album.genre ? ` · ${album.genre}` : ''}
            {' · '}
            {album.tracks.length} song{album.tracks.length === 1 ? '' : 's'}
            {', '}
            {formatTime(total)}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={() => play(0)}>
          <Play size={16} fill="currentColor" /> Play
        </button>
        <button className="btn btn-ghost" onClick={shuffle}>
          <Shuffle size={16} /> Shuffle
        </button>
        <button className="btn btn-ghost" onClick={() => addToQueue(album.tracks)}>
          <ListPlus size={16} /> Add to queue
        </button>
      </div>

      <TrackList tracks={album.tracks} showAlbum={false} showIndex />

      <div style={{ marginTop: 24, color: 'var(--text-faint)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Clock3 size={13} /> Tip: double-click any track to play the album from there.
        {' '}
        <Link to="/nowplaying" style={{ color: 'var(--text-muted)' }}>Open Now Playing →</Link>
      </div>
    </div>
  );
}
