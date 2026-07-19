import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clapperboard, Play } from 'lucide-react';
import { movieThumbnailUrl } from '../api.ts';
import type { Movie } from '../types.ts';
import { formatDuration } from '../lib/format.ts';

export type MovieViewMode = 'grid' | 'list';

export function MovieGrid({
  movies,
  view = 'grid',
}: {
  movies: Movie[];
  view?: MovieViewMode;
}) {
  if (movies.length === 0) return <div className="empty-state">No movies found.</div>;
  return (
    <div className={`movie-grid ${view === 'list' ? 'is-list' : ''}`}>
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
}

export function MovieCard({ movie }: { movie: Movie }) {
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const progress =
    movie.resumeDuration > 0
      ? Math.min(100, Math.max(0, (movie.resumePosition / movie.resumeDuration) * 100))
      : 0;

  return (
    <article className="movie-card">
      <div className="movie-card-image">
        <Link
          to={`/movie/${movie.id}`}
          state={{ returnTo }}
          className="movie-card-detail-link"
          aria-label={movie.title}
        >
          {!failed ? (
            <img
              src={movieThumbnailUrl(movie.id)}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="movie-thumb-fallback">
              <Clapperboard size={34} strokeWidth={1.4} />
            </div>
          )}
        </Link>
        <div className="movie-card-shade" />
        <Link
          to={`/movie/watch/${movie.id}`}
          state={{ returnTo }}
          className="movie-card-play"
          aria-label={`Play ${movie.title}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Play size={18} fill="currentColor" />
        </Link>
        <span className="movie-format">{movie.format.toUpperCase()}</span>
        {progress > 0 && (
          <div className="movie-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="movie-card-copy">
        <h3>
          <Link to={`/movie/${movie.id}`} state={{ returnTo }}>
            {movie.title}
          </Link>
        </h3>
        <p>
          {movie.year ? `${movie.year} · ` : ''}
          {formatDuration(movie.duration)}
          {movie.height ? ` · ${movie.height}p` : ''}
        </p>
        <span className="movie-list-codecs">
          {movie.videoCodec.toUpperCase()} · {movie.audioCodec.toUpperCase()}
        </span>
      </div>
    </article>
  );
}
