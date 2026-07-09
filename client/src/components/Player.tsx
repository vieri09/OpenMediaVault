import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Volume1,
  ListMusic,
  Heart,
  Maximize2,
} from 'lucide-react';
import { usePlayer } from '../stores/player.ts';
import { useLibrary } from '../stores/library.ts';
import { useUI } from '../stores/ui.ts';
import { coverUrl, streamUrl } from '../api.ts';
import { formatTime } from '../lib/format.ts';

export default function Player() {
  const audioRef = useRef<HTMLAudioElement>(null);

  const track = usePlayer((s) => s.currentTrack());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const pendingSeek = usePlayer((s) => s.pendingSeek);

  const togglePlay = usePlayer((s) => s.togglePlay);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const seek = usePlayer((s) => s.seek);
  const setCurrentTime = usePlayer((s) => s.setCurrentTime);
  const setDuration = usePlayer((s) => s.setDuration);
  const setPendingSeek = usePlayer((s) => s.setPendingSeek);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);

  const toggleQueue = useUI((s) => s.toggleQueue);
  const favorites = useLibrary((s) => s.favorites);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const pushRecent = useLibrary((s) => s.pushRecent);

  const [thumbError, setThumbError] = useState(false);
  useEffect(() => {
    setThumbError(false);
  }, [track?.id]);

  // Record recently played when the current track changes.
  useEffect(() => {
    if (track) pushRecent(track);
  }, [track?.id, track, pushRecent]);

  // Apply src when the track changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    const wasPlaying = !audio.paused;
    audio.src = streamUrl(track.id);
    audio.load();
    if (wasPlaying || isPlaying) {
      void audio.play().catch(() => {
        /* autoplay may be blocked until user gesture */
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  // Apply play/pause.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (isPlaying) {
      void audio.play().catch(() => usePlayer.getState().setPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, track]);

  // Apply volume / mute.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // Apply programmatic seeks.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || pendingSeek === null) return;
    try {
      audio.currentTime = pendingSeek;
    } catch {
      /* not yet seekable */
    }
    setPendingSeek(null);
  }, [pendingSeek, setPendingSeek]);

  const onTimeUpdate = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  };
  const onLoadedMetadata = (): void => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    setDuration(Number.isFinite(audio.duration) ? audio.duration : track.duration);
  };
  const onEnded = (): void => {
    next(true);
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = Number.parseFloat(e.target.value);
    seek(v);
  };

  const fav = track ? favorites.includes(track.id) : false;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        preload="metadata"
      />
      <div className="player">
        {/* Left column — cover, title/artist, favorite */}
        <div className="track-info">
          {track ? (
            <>
              {track.hasCover && !thumbError ? (
                <img
                  className="player-thumb"
                  src={coverUrl(track.id)}
                  alt=""
                  onError={() => setThumbError(true)}
                />
              ) : (
                <div className="player-thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
                  <Play size={18} />
                </div>
              )}
              <div className="details">
                <div className="title">{track.title}</div>
                <div className="artist">{track.artist || 'Unknown Artist'}</div>
              </div>
              <button
                className={`btn-icon ${fav ? 'active' : ''}`}
                title={fav ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => toggleFavorite(track.id)}
                style={fav ? { color: 'var(--danger)' } : undefined}
              >
                <Heart size={17} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </>
          ) : (
            <>
              <div className="player-thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
                <Play size={18} />
              </div>
              <div className="details">
                <div className="title" style={{ color: 'var(--text-muted)' }}>Nothing playing</div>
                <div className="artist">Pick something from your library</div>
              </div>
            </>
          )}
        </div>

        {/* Center column — progress on top, transport buttons below */}
        <div className="player-controls">
          <div className="progress-container">
            <span className="time">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={onScrub}
              disabled={!track}
              aria-label="Seek"
              style={{ '--slider-progress': `${duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0}%` } as React.CSSProperties}
            />
            <span className="time">{formatTime(duration)}</span>
          </div>
          <div className="player-buttons">
            <button
              className={`btn-icon ${shuffle ? 'active' : ''}`}
              onClick={toggleShuffle}
              title="Shuffle (S)"
              aria-label="Shuffle"
            >
              <Shuffle size={17} />
            </button>
            <button className="btn-icon" onClick={prev} title="Previous (Shift+←)" aria-label="Previous">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              className="btn-icon btn-play"
              onClick={togglePlay}
              title="Play/Pause (Space)"
              aria-label="Play or pause"
              disabled={!track}
            >
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button className="btn-icon" onClick={() => next()} title="Next (Shift+→)" aria-label="Next">
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              className={`btn-icon ${repeat !== 'off' ? 'active' : ''}`}
              onClick={cycleRepeat}
              title={`Repeat: ${repeat} (R)`}
              aria-label="Repeat"
            >
              {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
            </button>
          </div>
        </div>

        {/* Right column — volume + queue / now playing */}
        <div className="player-actions">
          <div className="volume">
            <button className="btn-icon" onClick={toggleMute} title="Mute (M)" aria-label="Mute">
              <VolIcon size={18} />
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
          <button className="btn-icon" onClick={toggleQueue} title="Queue (Q)" aria-label="Queue">
            <ListMusic size={18} />
          </button>
          {track && (
            <Link to="/nowplaying" className="btn-icon" title="Now playing" aria-label="Now playing">
              <Maximize2 size={17} />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
