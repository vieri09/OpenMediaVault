import { useEffect } from 'react';
import { usePlayer } from '../stores/player.ts';
import { coverUrl } from '../api.ts';

/**
 * Wire playback into the OS-level Media Session API so hardware media keys,
 * lock-screen controls, and desktop media UI drive the player. No-op when the
 * browser doesn't support it.
 */
export function useMediaSession(): void {
  const player = usePlayer();
  const track = usePlayer((s) => s.currentTrack());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;

    if (track) {
      ms.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        album: track.album || 'Unknown Album',
        artwork: [
          { src: coverUrl(track.id), sizes: '512x512', type: 'image/png' },
          { src: coverUrl(track.id), sizes: '300x300', type: 'image/jpeg' },
        ],
      });
      ms.playbackState = isPlaying ? 'playing' : 'paused';
    } else {
      ms.metadata = null;
      ms.playbackState = 'none';
    }

    const setPosition = (): void => {
      try {
        if (typeof ms.setPositionState === 'function' && Number.isFinite(duration) && duration > 0) {
          ms.setPositionState({
            duration,
            position: Math.min(currentTime, duration),
            playbackRate: 1,
          });
        }
      } catch {
        /* setPositionState can throw if not supported */
      }
    };
    setPosition();

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => player.setPlaying(true)],
      ['pause', () => player.setPlaying(false)],
      ['previoustrack', () => player.prev()],
      ['nexttrack', () => player.next(true)],
      ['seekbackward', () => player.seekBy(-10)],
      ['seekforward', () => player.seekBy(10)],
      [
        'seekto',
        (details) => {
          if (details.seekTime != null) player.seek(details.seekTime);
        },
      ],
      ['stop', () => player.setPlaying(false)],
    ];

    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported in this browser */
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [track, isPlaying, currentTime, duration, player]);
}
