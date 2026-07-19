import { Link, useLocation, useParams } from 'react-router-dom';
import useSWR from 'swr';
import { ArrowLeft, Play, RotateCcw } from 'lucide-react';
import { api, movieThumbnailUrl } from '../api.ts';
import { Loading } from '../components/common.tsx';
import { formatDuration } from '../lib/format.ts';

export default function MovieDetail() {
  const { id } = useParams();
  const location = useLocation();
  const state = location.state as { returnTo?: unknown } | null;
  const returnTo =
    typeof state?.returnTo === 'string' && state.returnTo.startsWith('/movie')
      ? state.returnTo
      : '/movie';
  const { data: movie, error, mutate } = useSWR(
    id ? `/api/movies/${id}` : null,
    () => api.movie(id!),
  );

  if (error) return <div className="error">Movie not found.</div>;
  if (!movie) return <Loading />;

  const resume = movie.resumePosition >= 5;
  const reset = async (): Promise<void> => {
    await api.clearMovieProgress(movie.id);
    await mutate();
  };

  return (
    <div className="movie-detail">
      <div
        className="movie-detail-backdrop"
        style={{ '--movie-detail-image': `url("${movieThumbnailUrl(movie.id)}")` } as React.CSSProperties}
      />
      <div className="movie-detail-shade" />
      <div className="movie-detail-content">
        <Link to={returnTo} className="movie-back">
          <ArrowLeft size={18} /> Movies
        </Link>
        <span className="movie-eyebrow">Local movie</span>
        <h1>{movie.title}</h1>
        <p className="movie-detail-meta">
          {movie.year ? `${movie.year} · ` : ''}
          {formatDuration(movie.duration)} · {movie.width}×{movie.height} ·{' '}
          {movie.videoCodec.toUpperCase()} / {movie.audioCodec.toUpperCase() || 'No audio'}
        </p>
        {movie.folder && <p className="movie-folder">{movie.folder}</p>}
        <div className="detail-actions">
          <Link
            to={`/movie/watch/${movie.id}`}
            state={{ returnTo }}
            className="btn btn-primary movie-detail-play"
          >
            <Play size={17} fill="currentColor" /> {resume ? 'Resume movie' : 'Play movie'}
          </Link>
          {resume && (
            <button className="btn btn-ghost" onClick={reset}>
              <RotateCcw size={15} /> Start over
            </button>
          )}
        </div>
        <div className="movie-tech">
          <span>{movie.format.toUpperCase()}</span>
          <span>{movie.playbackMode === 'direct' ? 'Direct browser playback' : 'FFmpeg optimized HLS'}</span>
          {resume && <span>Resume at {formatDuration(movie.resumePosition)}</span>}
        </div>
      </div>
    </div>
  );
}
