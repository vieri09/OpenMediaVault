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
  Volume2,
  Volume1,
  VolumeX,
  Disc3,
} from 'lucide-react';
import { usePlayer } from '../stores/player.ts';
import { useLibrary } from '../stores/library.ts';
import { useUI } from '../stores/ui.ts';
import { coverUrl } from '../api.ts';
import { formatTime } from '../lib/format.ts';

/**
 * Immersive "Now Playing" view, modeled on Monochrome's fullscreen overlay:
 * a single centered media column (artwork → title/artist → actions → up next
 * → progress → large transport buttons → volume) floating over a blurred copy
 * of the cover art. While this route is open the floating mini-player is
 * hidden (see `.app.on-nowplaying` in styles.css) so this is the sole control
 * surface.
 */
export default function NowPlaying() {
  const navigate = useNavigate();
  const track = usePlayer((s) => s.currentTrack());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const queue = usePlayer((s) => s.queue);
  const order = usePlayer((s) => s.order);
  const index = usePlayer((s) => s.index);

  const togglePlay = usePlayer((s) => s.togglePlay);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const seek = usePlayer((s) => s.seek);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
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
  const upNext = index >= 0 && index + 1 < order.length ? queue[order[index + 1]] ?? null : null;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const cover = track.hasCover ? coverUrl(track.id) : null;

  return (
    <div className="np-view">
      {cover && <div className="np-backdrop" style={{ backgroundImage: `url(${cover})` }} aria-hidden />}
      <div className="np-backdrop-shade" aria-hidden />

      <button className="btn-icon np-back" onClick={() => navigate(-1)} title="Back" aria-label="Back">
        <ChevronLeft size={22} />
      </button>

      <div className="np-media">
        <div className="np-artwork">
          {cover ? (
            <img src={cover} alt={track.title} />
          ) : (
            <div className="np-artwork-fallback">
              <Disc3 size={64} />
            </div>
          )}
        </div>

        <div className="np-info">
          <h1 className="np-title">{track.title}</h1>
          <div className="np-artist">
            {track.artist || 'Unknown Artist'}
            {track.album ? <span className="np-album"> · {track.album}</span> : null}
          </div>

          <div className="np-actions">
            <button
              className={`btn-icon ${fav ? 'active' : ''}`}
              onClick={() => toggleFavorite(track.id)}
              title={fav ? 'Remove from favorites' : 'Add to favorites'}
              style={fav ? { color: 'var(--danger)' } : undefined}
            >
              <Heart size={20} fill={fav ? 'currentColor' : 'none'} />
            </button>
            <button className="btn-icon" onClick={toggleQueue} title="Queue (Q)" aria-label="Queue">
              <ListMusic size={20} />
            </button>
          </div>

          {upNext && (
            <div className="np-upnext">
              <span className="label">Up Next</span>
              <span className="value">
                {upNext.title} — {upNext.artist || 'Unknown Artist'}
              </span>
            </div>
          )}
        </div>

        <div className="np-controls">
          <div className="np-progress">
            <span className="time">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number.parseFloat(e.target.value))}
              aria-label="Seek"
              style={{ '--slider-progress': `${duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0}%` } as React.CSSProperties}
            />
            <span className="time">{formatTime(duration)}</span>
          </div>

          <div className="np-buttons">
            <button className={`btn-icon ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle (S)" aria-label="Shuffle">
              <Shuffle size={22} />
            </button>
            <button className="btn-icon" onClick={prev} title="Previous (Shift+←)" aria-label="Previous">
              <SkipBack size={26} fill="currentColor" />
            </button>
            <button className="np-play" onClick={togglePlay} title="Play/Pause (Space)" aria-label="Play or pause">
              {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
            </button>
            <button className="btn-icon" onClick={() => next()} title="Next (Shift+→)" aria-label="Next">
              <SkipForward size={26} fill="currentColor" />
            </button>
            <button className={`btn-icon ${repeat !== 'off' ? 'active' : ''}`} onClick={cycleRepeat} title={`Repeat: ${repeat} (R)`} aria-label="Repeat">
              {repeat === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
            </button>
          </div>

          <div className="np-volume">
            <button className="btn-icon" onClick={toggleMute} title="Mute (M)" aria-label="Mute">
              <VolIcon size={20} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number.parseFloat(e.target.value))}
              aria-label="Volume"
              style={{ '--slider-progress': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
