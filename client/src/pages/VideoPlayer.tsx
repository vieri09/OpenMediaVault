import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import Hls from 'hls.js/light';
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  api,
  movieHlsUrl,
  movieSubtitleUrl,
  movieStreamUrl,
  stopMovieHls,
} from '../api.ts';
import { Loading } from '../components/common.tsx';
import { formatTime } from '../lib/format.ts';

const SUBTITLE_BUCKET_SECONDS = 5 * 60;
const HLS_START_BUFFER_SECONDS = 4;
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 80;

function subtitleBucket(position: number): number {
  return Math.floor(Math.max(0, position) / SUBTITLE_BUCKET_SECONDS) *
    SUBTITLE_BUCKET_SECONDS;
}

function newPlaybackSessionId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

function supportsNativeHls(video: HTMLVideoElement): boolean {
  if (video.canPlayType('application/vnd.apple.mpegurl') === '') return false;
  const userAgent = navigator.userAgent;
  const appleMobile =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const desktopSafari =
    /Safari/.test(userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(userAgent);
  return appleMobile || desktopSafari;
}

export default function VideoPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { returnTo?: unknown } | null;
  const returnTo =
    typeof routeState?.returnTo === 'string' && routeState.returnTo.startsWith('/movie')
      ? routeState.returnTo
      : `/movie/${id}`;
  const { data: movie, error } = useSWR(id ? `/api/movies/${id}` : null, () => api.movie(id!));
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const directPlaybackRef = useRef(false);
  const baseOffsetRef = useRef(0);
  const audioStreamRef = useRef(-1);
  const startHlsRef = useRef<
    (position: number, audioStream?: number, forceCompatibility?: boolean) => void
  >(() => {});
  const recoverPlaybackRef = useRef<() => void>(() => {});
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfaceTapRef = useRef<{
    time: number;
    x: number;
    pointerType: string;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ time: 0, x: 0, pointerType: '', timer: null });
  const subtitleWindowRef = useRef(0);
  const progressRef = useRef({ position: 0, duration: 0 });

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [status, setStatus] = useState('Preparing movie…');
  const [playbackError, setPlaybackError] = useState('');
  const [audioStream, setAudioStream] = useState(-1);
  const [subtitleStream, setSubtitleStream] = useState(-1);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [subtitleWindow, setSubtitleWindow] = useState(0);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleError, setSubtitleError] = useState('');
  const [playbackTransport, setPlaybackTransport] = useState<'direct' | 'hls'>('direct');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [seekingPosition, setSeekingPosition] = useState<number | null>(null);
  const [seekFeedback, setSeekFeedback] = useState<{
    direction: 'back' | 'forward';
    key: number;
  } | null>(null);

  const duration = movie?.duration ?? 0;
  const transcoded = playbackTransport === 'hls';
  const selectedSubtitleTrack = movie?.subtitleTracks.find(
    (track) => track.streamIndex === subtitleStream,
  );

  const destroyHls = useCallback(() => {
    if (startupTimerRef.current) {
      clearTimeout(startupTimerRef.current);
      startupTimerRef.current = null;
    }
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const pokeControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!videoRef.current?.paused) setShowControls(false);
    }, 3200);
  }, []);

  const clearBufferingStatus = useCallback(() => {
    if (bufferingTimerRef.current) {
      clearTimeout(bufferingTimerRef.current);
      bufferingTimerRef.current = null;
    }
    setStatus((current) => current === 'Buffering…' ? '' : current);
  }, []);

  const scheduleBufferingStatus = useCallback((video: HTMLVideoElement) => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = setTimeout(() => {
      bufferingTimerRef.current = null;
      if (!video.paused && !video.ended && video.readyState < 3) {
        setStatus((current) => current || 'Buffering…');
      }
    }, 900);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || video.readyState >= 3) {
        clearBufferingStatus();
      }
    }, 350);
    return () => {
      clearInterval(timer);
      if (bufferingTimerRef.current) {
        clearTimeout(bufferingTimerRef.current);
        bufferingTimerRef.current = null;
      }
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (surfaceTapRef.current.timer) clearTimeout(surfaceTapRef.current.timer);
      if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    };
  }, [clearBufferingStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !movie) return;
    let disposed = false;
    const playbackSessionId = newPlaybackSessionId();
    const nativeResume = movie.resumePosition >= 5 ? movie.resumePosition : 0;
    const defaultAudioStream = movie.audioTracks[0]?.streamIndex ?? -1;
    audioStreamRef.current = defaultAudioStream;
    setAudioStream(defaultAudioStream);
    setSubtitleStream(-1);
    setSubtitleOffset(0);
    subtitleWindowRef.current = 0;
    setSubtitleWindow(0);
    setSubtitleLoading(false);
    setSubtitleError('');
    setPlaybackError('');
    setPosition(nativeResume);
    progressRef.current = { position: nativeResume, duration: movie.duration };

    const playWhenBuffered = (
      targetSeconds = 0,
      recover?: () => void,
    ): void => {
      if (disposed) return;
      if (startupTimerRef.current) clearTimeout(startupTimerRef.current);
      const started = Date.now();
      const check = (): void => {
        if (disposed) return;
        let bufferAhead = 0;
        try {
          for (let index = 0; index < video.buffered.length; index++) {
            const rangeStart = video.buffered.start(index);
            const rangeEnd = video.buffered.end(index);
            if (video.currentTime >= rangeStart - 0.25 && video.currentTime <= rangeEnd) {
              bufferAhead = Math.max(0, rangeEnd - video.currentTime);
              break;
            }
          }
        } catch {
          // The browser is updating its buffered ranges.
        }
        const absolute = baseOffsetRef.current + video.currentTime;
        const required = Math.min(targetSeconds, Math.max(0, movie.duration - absolute));
        if (required <= 0 || bufferAhead >= required || Date.now() - started >= 30_000) {
          startupTimerRef.current = null;
          setStatus('');
          void video.play().catch((error: unknown) => {
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
              // The explicit play button will satisfy the browser gesture requirement.
              return;
            }
            if (recover) {
              recover();
              return;
            }
            const message = error instanceof Error ? error.message : 'Unknown media error';
            setPlaybackError(`Could not start movie playback: ${message}`);
          });
          return;
        }
        setStatus(
          `Building playback buffer… ${Math.min(required, Math.floor(bufferAhead))} / ${Math.ceil(required)}s`,
        );
        startupTimerRef.current = setTimeout(check, 250);
      };
      check();
    };

    const startHls = (
      absolutePosition: number,
      requestedAudioStream = audioStreamRef.current,
      forceCompatibility = false,
    ): void => {
      if (disposed) return;
      destroyHls();
      directPlaybackRef.current = false;
      setPlaybackTransport('hls');
      audioStreamRef.current = requestedAudioStream;
      const start = Math.max(0, Math.min(movie.duration, absolutePosition));
      baseOffsetRef.current = start;
      setSubtitleOffset(start);
      const windowStart = subtitleBucket(start);
      subtitleWindowRef.current = windowStart;
      setSubtitleWindow(windowStart);
      setPosition(start);
      setBuffered(start);
      const nativeHls = supportsNativeHls(video);
      const hevcSource =
        !forceCompatibility &&
        nativeHls &&
        (movie.videoCodec === 'hevc' || movie.videoCodec === 'h265') &&
        video.canPlayType('video/mp4; codecs="hvc1"') !== '';
      setStatus(
        hevcSource
          ? 'Preparing original-quality HEVC playback…'
          : movie.videoCodec === 'hevc' || movie.videoCodec === 'h265'
            ? 'Preparing high-quality browser playback…'
            : 'Preparing optimized playback…',
      );
      const source = movieHlsUrl(
        movie.id,
        start,
        requestedAudioStream,
        hevcSource,
        playbackSessionId,
      );

      const fallbackToCompatibility = (): void => {
        if (!disposed && hevcSource) {
          setPlaybackError('');
          setStatus('Using browser-compatible high quality…');
          startHls(
            baseOffsetRef.current + video.currentTime,
            requestedAudioStream,
            true,
          );
        }
      };
      recoverPlaybackRef.current = hevcSource
        ? fallbackToCompatibility
        : () => {
            const mediaError = video.error;
            const detail = mediaError
              ? `Media error ${mediaError.code}${mediaError.message ? `: ${mediaError.message}` : ''}`
              : 'The browser rejected this media stream.';
            setPlaybackError(detail);
          };

      if (nativeHls) {
        const startAfterMetadata = (): void =>
          playWhenBuffered(HLS_START_BUFFER_SECONDS, hevcSource ? fallbackToCompatibility : undefined);
        const fallback = (): void => {
          if (!disposed && hevcSource) {
            video.removeEventListener('loadedmetadata', startAfterMetadata);
            fallbackToCompatibility();
          }
        };
        video.src = source;
        video.load();
        if (hevcSource) video.addEventListener('error', fallback, { once: true });
        video.addEventListener('loadedmetadata', startAfterMetadata, { once: true });
        return;
      }
      if (!Hls.isSupported()) {
        setPlaybackError('This browser does not support HLS playback.');
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        startPosition: 0,
        initialLiveManifestSize: 1,
        maxBufferLength: 60,
        maxMaxBufferLength: 60,
        maxBufferSize: 192 * 1000 * 1000,
        maxBufferHole: 0.3,
        backBufferLength: 45,
        startFragPrefetch: true,
        manifestLoadingTimeOut: 45_000,
        fragLoadingTimeOut: 35_000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 30_000,
      });
      hlsRef.current = hls;
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(
        Hls.Events.MANIFEST_PARSED,
        () => playWhenBuffered(HLS_START_BUFFER_SECONDS),
      );
      let mediaRecoveryAttempts = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
            setPlaybackError('Could not load the movie stream from the server.');
          } else {
            hls.startLoad();
          }
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (hevcSource && mediaRecoveryAttempts >= 1) {
            startHls(start, requestedAudioStream, true);
            return;
          }
          mediaRecoveryAttempts++;
          hls.recoverMediaError();
          return;
        }
        if (hevcSource) {
          fallbackToCompatibility();
          return;
        }
        setPlaybackError(
          `Optimized movie playback failed (${data.details || data.type}).`,
        );
      });
    };
    startHlsRef.current = startHls;

    const loadDirectSource = (resumePosition: number, fallbackToHls: boolean): void => {
      directPlaybackRef.current = true;
      setPlaybackTransport('direct');
      baseOffsetRef.current = 0;
      setSubtitleOffset(0);
      setStatus(fallbackToHls ? 'Opening original-quality movie…' : 'Loading movie…');
      const onLoadedMetadata = (): void => {
        if (resumePosition > 5 && resumePosition < video.duration - 5) {
          video.currentTime = resumePosition;
        }
        playWhenBuffered();
      };
      const fallback = (): void => {
        if (!disposed && fallbackToHls) {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          directPlaybackRef.current = false;
          setStatus('Using optimized high-quality playback…');
          startHls(video.currentTime || resumePosition, audioStreamRef.current);
        }
      };
      video.src = movieStreamUrl(movie.id);
      video.load();
      if (fallbackToHls) video.addEventListener('error', fallback, { once: true });
      video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    };

    const canDirectPlayHevc =
      movie.playbackMode === 'hls' &&
      (movie.format === 'mp4' || movie.format === 'm4v') &&
      (movie.videoCodec === 'hevc' || movie.videoCodec === 'h265') &&
      (movie.audioCodec === '' || movie.audioCodec === 'aac' || movie.audioCodec === 'mp3') &&
      movie.audioTracks.length <= 1 &&
      video.canPlayType('video/mp4; codecs="hvc1"') !== '';

    if (movie.playbackMode === 'direct') {
      loadDirectSource(nativeResume, false);
    } else if (canDirectPlayHevc) {
      loadDirectSource(nativeResume, true);
    } else {
      startHls(nativeResume);
    }

    return () => {
      disposed = true;
      destroyHls();
      video.removeAttribute('src');
      video.load();
      if (movie.playbackMode === 'hls') {
        void stopMovieHls(movie.id, playbackSessionId);
      }
    };
  }, [destroyHls, movie]);

  useEffect(() => {
    if (!movie) return;
    const save = (): void => {
      const latest = progressRef.current;
      if (latest.duration > 0) {
        void api.saveMovieProgress(movie.id, latest.position, latest.duration).catch(() => {});
      }
    };
    const timer = setInterval(save, 10_000);
    const onPageHide = (): void => save();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      save();
    };
  }, [movie]);

  useEffect(() => {
    const onFullscreen = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (let index = 0; index < tracks.length; index++) {
      tracks[index].mode = subtitleStream >= 0 ? 'showing' : 'disabled';
    }
  }, [selectedSubtitleTrack, subtitleOffset, subtitleStream]);

  const absolutePosition = useCallback((): number => {
    const video = videoRef.current;
    if (!video) return 0;
    return baseOffsetRef.current + video.currentTime;
  }, []);

  const onTimeUpdate = (): void => {
    const video = videoRef.current;
    if (!video || !movie) return;
    const absolute = absolutePosition();
    setPosition(absolute);
    if (video.readyState >= 3) clearBufferingStatus();
    if (subtitleStream >= 0) {
      const nextWindow = subtitleBucket(absolute);
      if (nextWindow !== subtitleWindowRef.current) {
        subtitleWindowRef.current = nextWindow;
        setSubtitleWindow(nextWindow);
        setSubtitleLoading(true);
      }
    }
    progressRef.current = { position: absolute, duration: movie.duration };
    try {
      if (video.buffered.length) {
        setBuffered(baseOffsetRef.current + video.buffered.end(video.buffered.length - 1));
      }
    } catch {
      // Browser is updating the buffered ranges.
    }
  };

  const seek = (target: number): void => {
    const video = videoRef.current;
    if (!video || !movie) return;
    const clamped = Math.max(0, Math.min(movie.duration, target));
    if (directPlaybackRef.current) {
      video.currentTime = clamped;
      setPosition(clamped);
      return;
    }

    const relative = clamped - baseOffsetRef.current;
    let bufferedEnd = 0;
    try {
      if (video.buffered.length) bufferedEnd = video.buffered.end(video.buffered.length - 1);
    } catch {
      // Use a seek-restart.
    }
    if (relative >= 0 && relative <= bufferedEnd + 0.5) {
      video.currentTime = relative;
      setPosition(clamped);
    } else {
      startHlsRef.current(clamped);
    }
  };

  const togglePlay = (): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setPlaybackError('');
      void video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setPlaybackError('The browser blocked playback. Tap Play once more.');
          return;
        }
        recoverPlaybackRef.current();
      });
    }
    else video.pause();
  };

  const changeVolume = (value: number): void => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen();
  };

  const showSeekFeedback = (direction: 'back' | 'forward'): void => {
    if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    setSeekFeedback({ direction, key: Date.now() });
    seekFeedbackTimerRef.current = setTimeout(() => {
      seekFeedbackTimerRef.current = null;
      setSeekFeedback(null);
    }, 650);
  };

  const handleSurfacePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const now = performance.now();
    const previous = surfaceTapRef.current;
    const isDoubleTap =
      previous.pointerType === event.pointerType &&
      now - previous.time <= DOUBLE_TAP_WINDOW_MS &&
      Math.abs(x - previous.x) <= DOUBLE_TAP_DISTANCE_PX;

    if (isDoubleTap) {
      if (previous.timer) clearTimeout(previous.timer);
      surfaceTapRef.current = { time: 0, x: 0, pointerType: '', timer: null };
      if (event.pointerType === 'mouse') {
        toggleFullscreen();
      } else {
        const zone = x / Math.max(1, rect.width);
        if (zone < 0.4) {
          seek(absolutePosition() - 10);
          showSeekFeedback('back');
        } else if (zone > 0.6) {
          seek(absolutePosition() + 10);
          showSeekFeedback('forward');
        } else {
          togglePlay();
        }
        pokeControls();
      }
      return;
    }

    const timer = setTimeout(() => {
      surfaceTapRef.current.timer = null;
      if (playing && showControls) {
        setShowControls(false);
      } else {
        pokeControls();
      }
    }, DOUBLE_TAP_WINDOW_MS);
    surfaceTapRef.current = {
      time: now,
      x,
      pointerType: event.pointerType,
      timer,
    };
  };

  const commitTimelineSeek = (target: number): void => {
    setSeekingPosition(null);
    seek(target);
    pokeControls();
  };

  const changePlaybackRate = (rate: number): void => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    pokeControls();
  };

  const changeAudioStream = (streamIndex: number): void => {
    if (!movie || directPlaybackRef.current || streamIndex === audioStreamRef.current) return;
    audioStreamRef.current = streamIndex;
    setAudioStream(streamIndex);
    setStatus('Switching audio track…');
    startHlsRef.current(absolutePosition(), streamIndex);
  };

  const changeSubtitleStream = (streamIndex: number): void => {
    const windowStart = subtitleBucket(absolutePosition());
    subtitleWindowRef.current = windowStart;
    setSubtitleWindow(windowStart);
    setSubtitleStream(streamIndex);
    setSubtitleError('');
    setSubtitleLoading(streamIndex >= 0);
    if (streamIndex < 0) {
      const tracks = videoRef.current?.textTracks;
      if (!tracks) return;
      for (let index = 0; index < tracks.length; index++) tracks[index].mode = 'disabled';
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, button')) {
        if (event.key === 'Escape' && !document.fullscreenElement) navigate(returnTo);
        return;
      }
      pokeControls();
      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'j') {
        seek(position - 10);
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'l') {
        seek(position + 10);
      } else if (event.key.toLowerCase() === 'f') {
        toggleFullscreen();
      } else if (event.key.toLowerCase() === 'm') {
        const video = videoRef.current;
        if (video) video.muted = !video.muted;
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        navigate(returnTo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <div className="video-error">Movie not found.</div>;
  if (!movie) return <div className="video-loading"><Loading /></div>;

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const displayPosition = seekingPosition ?? position;
  const progressPercent = duration > 0 ? (displayPosition / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  const remaining = Math.max(0, duration - displayPosition);

  return (
    <div
      className={`video-player-shell ${showControls ? 'controls-visible' : ''}`}
      ref={shellRef}
      onMouseMove={pokeControls}
    >
      <video
        ref={videoRef}
        className="video-screen"
        playsInline
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onProgress={onTimeUpdate}
        onPlay={() => {
          setPlaying(true);
          setStatus('');
          pokeControls();
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
          clearBufferingStatus();
        }}
        onWaiting={(event) => scheduleBufferingStatus(event.currentTarget)}
        onStalled={(event) => scheduleBufferingStatus(event.currentTarget)}
        onCanPlay={clearBufferingStatus}
        onLoadedData={clearBufferingStatus}
        onPlaying={() => setStatus('')}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
        onError={() => {
          if (videoRef.current?.currentSrc) recoverPlaybackRef.current();
        }}
        onEnded={() => {
          setPlaying(false);
          void api.clearMovieProgress(movie.id);
        }}
      >
        {selectedSubtitleTrack && (
          <track
            key={
              `${selectedSubtitleTrack.streamIndex}-` +
              `${Math.floor(subtitleOffset)}-${subtitleWindow}`
            }
            kind="subtitles"
            src={movieSubtitleUrl(
              movie.id,
              selectedSubtitleTrack.streamIndex,
              subtitleOffset,
              subtitleWindow,
            )}
            srcLang={selectedSubtitleTrack.language || 'und'}
            label={
              selectedSubtitleTrack.title ||
              selectedSubtitleTrack.language?.toUpperCase() ||
              'Subtitles'
            }
            default
            onLoad={(event) => {
              event.currentTarget.track.mode = 'showing';
              setSubtitleLoading(false);
              setSubtitleError('');
            }}
            onError={() => {
              setSubtitleLoading(false);
              setSubtitleError('Could not load this subtitle track.');
            }}
          />
        )}
      </video>

      <div
        className="video-interaction-layer"
        onPointerUp={handleSurfacePointerUp}
        aria-label="Tap to show controls. Double tap the sides to seek."
      />
      <div className="video-vignette" />
      <div className="video-topbar">
        <button
          className="video-back"
          onClick={() => navigate(returnTo)}
          aria-label="Back to movie details"
        >
          <ArrowLeft size={25} />
        </button>
        <div className="video-title-block">
          <strong>{movie.title}</strong>
          <span>
            {movie.year ? `${movie.year} · ` : ''}
            {movie.height ? `${movie.height}p · ` : ''}
            {movie.format.toUpperCase()}
          </span>
        </div>
      </div>

      {(status || playbackError) && (
        <div
          className={[
            'video-status',
            playbackError ? 'video-status-error' : '',
            status === 'Buffering…' ? 'video-status-buffering' : '',
          ].filter(Boolean).join(' ')}
        >
          {!playbackError && <div className="spinner" />}
          <span>{playbackError || status}</span>
          {playbackError && movie.playbackMode === 'hls' && (
            <button
              className="video-retry-button"
              onClick={() => {
                setPlaybackError('');
                setStatus('Retrying browser-compatible playback…');
                startHlsRef.current(
                  absolutePosition(),
                  audioStreamRef.current,
                  true,
                );
              }}
            >
              Retry compatible playback
            </button>
          )}
        </div>
      )}

      {!status && !playbackError && (
        <div className="video-center-controls">
          <button
            className="video-center-button video-center-skip"
            onClick={() => {
              seek(absolutePosition() - 10);
              showSeekFeedback('back');
            }}
            aria-label="Back 10 seconds"
          >
            <RotateCcw size={34} />
            <span>10</span>
          </button>
          <button
            className="video-center-button video-center-play"
            onClick={togglePlay}
            aria-label={playing ? 'Pause movie' : 'Play movie'}
          >
            {playing
              ? <Pause size={42} fill="currentColor" />
              : <Play size={42} fill="currentColor" />}
          </button>
          <button
            className="video-center-button video-center-skip"
            onClick={() => {
              seek(absolutePosition() + 10);
              showSeekFeedback('forward');
            }}
            aria-label="Forward 10 seconds"
          >
            <RotateCw size={34} />
            <span>10</span>
          </button>
        </div>
      )}

      {seekFeedback && (
        <div
          key={seekFeedback.key}
          className={`video-seek-feedback video-seek-${seekFeedback.direction}`}
        >
          {seekFeedback.direction === 'back'
            ? <RotateCcw size={38} />
            : <RotateCw size={38} />}
          <span>10 seconds</span>
        </div>
      )}

      <div className="video-controls" onPointerDown={pokeControls}>
        <div className="video-timeline">
          <div className="video-buffered" style={{ width: `${Math.min(100, bufferedPercent)}%` }} />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={Math.min(displayPosition, duration || 0)}
            onChange={(event) => setSeekingPosition(Number.parseFloat(event.target.value))}
            onPointerUp={(event) =>
              commitTimelineSeek(Number.parseFloat(event.currentTarget.value))
            }
            onKeyUp={(event) =>
              commitTimelineSeek(Number.parseFloat(event.currentTarget.value))
            }
            onBlur={() => {
              if (seekingPosition !== null) commitTimelineSeek(seekingPosition);
            }}
            style={{ '--slider-progress': `${Math.min(100, progressPercent)}%` } as React.CSSProperties}
            aria-label="Movie position"
          />
          <div className="video-timeline-times" aria-hidden="true">
            <span>{formatTime(displayPosition)}</span>
            <span>-{formatTime(remaining)}</span>
          </div>
        </div>
        <div className="video-control-row">
          <div className="video-control-group">
            <button
              className="video-control-button video-main-play"
              onClick={togglePlay}
              aria-label={playing ? 'Pause movie' : 'Play movie'}
            >
              {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <button
              className="video-control-button video-bottom-skip"
              onClick={() => seek(position - 10)}
              title="Back 10 seconds"
              aria-label="Back 10 seconds"
            >
              <RotateCcw size={21} />
            </button>
            <button
              className="video-control-button video-bottom-skip"
              onClick={() => seek(position + 10)}
              title="Forward 10 seconds"
              aria-label="Forward 10 seconds"
            >
              <RotateCw size={21} />
            </button>
            <button
              className="video-control-button"
              onClick={() => {
                const video = videoRef.current;
                if (video) video.muted = !video.muted;
              }}
              aria-label={muted ? 'Unmute movie' : 'Mute movie'}
            >
              <VolumeIcon size={21} />
            </button>
            <input
              className="video-volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => changeVolume(Number.parseFloat(event.target.value))}
              style={{ '--slider-progress': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
              aria-label="Movie volume"
            />
            <span className="video-time">{formatTime(displayPosition)}</span>
          </div>
          <div className="video-control-group">
            <span className="video-mode">
              {transcoded ? 'Optimized HQ' : 'Original'}
            </span>
            {transcoded && movie.audioTracks.length > 1 && (
              <label className="video-track-picker">
                <span>Audio</span>
                <select
                  value={audioStream}
                  onChange={(event) => changeAudioStream(Number.parseInt(event.target.value, 10))}
                  aria-label="Audio track"
                >
                  {movie.audioTracks.map((track, index) => (
                    <option key={track.streamIndex} value={track.streamIndex}>
                      {track.title || track.language?.toUpperCase() || `Track ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {movie.subtitleTracks.length > 0 && (
              <label className="video-track-picker">
                <span>Subtitles</span>
                <select
                  value={subtitleStream}
                  onChange={(event) =>
                    changeSubtitleStream(Number.parseInt(event.target.value, 10))
                  }
                  aria-label="Subtitle track"
                >
                  <option value={-1}>Off</option>
                  {movie.subtitleTracks.map((track, index) => (
                    <option key={track.streamIndex} value={track.streamIndex}>
                      {track.title || track.language?.toUpperCase() || `Track ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {subtitleLoading && <span className="video-track-status">Loading subtitles…</span>}
            {subtitleError && (
              <span className="video-track-status video-track-error" title={subtitleError}>
                Subtitle unavailable
              </span>
            )}
            <label className="video-track-picker video-speed-picker">
              <span>Speed</span>
              <select
                value={playbackRate}
                onChange={(event) => changePlaybackRate(Number.parseFloat(event.target.value))}
                aria-label="Playback speed"
              >
                <option value={0.5}>0.5×</option>
                <option value={0.75}>0.75×</option>
                <option value={1}>Normal</option>
                <option value={1.25}>1.25×</option>
                <option value={1.5}>1.5×</option>
                <option value={2}>2×</option>
              </select>
            </label>
            <button
              className="video-control-button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
