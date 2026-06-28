import { useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ChevronLeft,
  ListMusic,
} from 'lucide-react';
import { usePlayer } from '../stores/player.ts';
import { useLibrary } from '../stores/library.ts';
import { useUI } from '../stores/ui.ts';
import { coverUrl } from '../api.ts';
import { formatTime } from '../lib/format.ts';
import { Cover } from '../components/Cover.tsx';

export default function NowPlaying() {
  const navigate = useNavigate();
  const track = usePlayer((s) => s.currentTrack());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const togglePlay = usePlayer((s) => s.togglePlay);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const seek = usePlayer((s) => s.seek);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const toggleQueue = useUI((s) => s.toggleQueue);
  const favorites = useLibrary((s) => s.favorites);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);

  if (!track) {
    return (
      <div className="content">
        <div className="empty-state">
          <h2>Nothing is playing</h2>
          <p className="muted">Choose a track from your library to see it here.</p>
        </div>
      </div>
    );
  }

  const fav = favorites.includes(track.id);

  return (
    <div className="content">
      <button className="btn-icon" style={{ marginBottom: 8 }} onClick={() => navigate(-1)} title="Back">
        <ChevronLeft size={20} />
      </button>
      <div className="now-playing-hero">
        <Cover coverTrackId={track.id} hasCover={track.hasCover} alt={track.title} className="np-cover" />
        <div style={{ maxWidth: 'min(440px, 80vw)' }}>
          <div className="np-title">{track.title}</div>
          <div className="np-artist">
            {track.artist || 'Unknown Artist'}
            {track.album ? ` — ${track.album}` : ''}
          </div>

          <div className="seekbar" style={{ maxWidth: 'min(440px, 80vw)', marginTop: 20 }}>
            <span className="time">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number.parseFloat(e.target.value))}
              aria-label="Seek"
            />
            <span className="time">{formatTime(duration)}</span>
          </div>

          <div className="player-controls" style={{ justifyContent: 'center', marginTop: 18 }}>
            <button className={`btn-icon ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle (S)">
              <Shuffle size={20} />
            </button>
            <button className="btn-icon" onClick={prev} title="Previous (Shift+←)">
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button className="btn-icon btn-play" onClick={togglePlay} title="Play/Pause (Space)">
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <button className="btn-icon" onClick={() => next()} title="Next (Shift+→)">
              <SkipForward size={22} fill="currentColor" />
            </button>
            <button className={`btn-icon ${repeat !== 'off' ? 'active' : ''}`} onClick={cycleRepeat} title="Repeat (R)">
              {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 18 }}>
            <button className={`btn-icon ${fav ? 'active' : ''}`} onClick={() => toggleFavorite(track.id)} title="Favorite">
              <Heart size={20} fill={fav ? 'currentColor' : 'none'} />
            </button>
            <button className="btn-icon" onClick={toggleQueue} title="Queue (Q)">
              <ListMusic size={20} />
            </button>
            {track.hasCover && (
              <a className="btn-icon" href={coverUrl(track.id)} target="_blank" rel="noreferrer" title="Cover art">
                <ListMusic size={20} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
