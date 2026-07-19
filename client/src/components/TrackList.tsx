import { ListMusic, Heart, Play, Plus } from 'lucide-react';
import type { Track } from '../types.ts';
import { usePlayer } from '../stores/player.ts';
import { useLibrary } from '../stores/library.ts';
import { formatTime } from '../lib/format.ts';
import { Cover } from './Cover.tsx';

interface TrackListProps {
  tracks: Track[];
  /** Whether to show album/cover columns (hidden inside album detail). */
  showAlbum?: boolean;
  /** Whether to show the index column. */
  showIndex?: boolean;
  /** Number added to displayed row positions when the parent is paginated. */
  indexOffset?: number;
  emptyMessage?: string;
}

/**
 * Reusable track table. Double-clicking a row (or pressing the play button)
 * replaces the queue with this list starting at that track.
 */
export function TrackList({
  tracks,
  showAlbum = true,
  showIndex = true,
  indexOffset = 0,
  emptyMessage,
}: TrackListProps) {
  const playTracks = usePlayer((s) => s.playTracks);
  const playNext = usePlayer((s) => s.playNext);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const currentId = usePlayer((s) => s.currentTrack()?.id ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const favorites = useLibrary((s) => s.favorites);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);

  if (tracks.length === 0) {
    return <div className="empty-state">{emptyMessage ?? 'No tracks.'}</div>;
  }

  return (
    <table className="tracklist">
      <thead>
        <tr>
          {showIndex && <th className="col-num">#</th>}
          <th>Title</th>
          {showAlbum && <th>Album</th>}
          <th className="col-duration">Time</th>
          <th className="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((track, i) => {
          const isCurrent = track.id === currentId;
          const fav = favorites.includes(track.id);
          return (
            <tr
              key={track.id}
              className={`row ${isCurrent ? 'playing' : ''}`}
              onDoubleClick={() => playTracks(tracks, i)}
            >
              {showIndex && (
                <td className="col-num">
                  {isCurrent ? (
                    <span className={`equalizer ${isPlaying ? '' : 'paused'}`} aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    indexOffset + i + 1
                  )}
                </td>
              )}
              <td>
                <div className="row-title">
                  <Cover
                    coverTrackId={track.id}
                    hasCover={track.hasCover}
                    alt=""
                    className="row-thumb"
                  />
                  <div className="row-title-text">
                    <div className={`t ${isCurrent ? 'playing-text' : ''}`}>{track.title}</div>
                    <div className="a">{track.artist || 'Unknown Artist'}</div>
                  </div>
                </div>
              </td>
              {showAlbum && (
                <td>
                  <div className="a" style={{ color: 'var(--text-muted)' }}>{track.album || '—'}</div>
                </td>
              )}
              <td className="col-duration">{formatTime(track.duration)}</td>
              <td className="col-actions">
                <div className="row-actions">
                  <button className="btn-icon btn-sm" title="Play" onClick={() => playTracks(tracks, i)}>
                    <Play size={16} />
                  </button>
                  <button className="btn-icon btn-sm" title="Play next" onClick={() => playNext([track])}>
                    <ListMusic size={16} />
                  </button>
                  <button className="btn-icon btn-sm" title="Add to queue" onClick={() => addToQueue([track])}>
                    <Plus size={16} />
                  </button>
                  <button
                    className={`btn-icon btn-sm ${fav ? 'active' : ''}`}
                    title={fav ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={() => toggleFavorite(track.id)}
                    style={fav ? { color: 'var(--danger)' } : undefined}
                  >
                    <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
