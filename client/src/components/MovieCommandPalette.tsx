import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, History, Search as SearchIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, movieThumbnailUrl } from '../api.ts';
import type { Movie } from '../types.ts';
import { formatDuration } from '../lib/format.ts';

interface MovieCommandPaletteProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

interface PaletteItem {
  key: string;
  label: string;
  sub?: string;
  movie?: Movie;
  icon?: 'movies' | 'continue';
  activate: () => void;
}

export default function MovieCommandPalette({
  open,
  setOpen,
}: MovieCommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const search = query.trim();
    if (!search) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .movies({ search, sort: 'title', order: 'asc', page: 1, limit: 12 })
        .then((page) => setResults(page.items))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(handle);
  }, [open, query]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!query.trim()) {
      return [
        {
          key: 'nav-movies',
          label: 'Go to Movies',
          icon: 'movies',
          activate: () => {
            navigate('/movie');
            setOpen(false);
          },
        },
        {
          key: 'nav-continue',
          label: 'Go to Continue Watching',
          icon: 'continue',
          activate: () => {
            navigate('/movie/continue');
            setOpen(false);
          },
        },
      ];
    }
    return results.map((movie) => ({
      key: movie.id,
      label: movie.title,
      sub: `${movie.year ? `${movie.year} · ` : ''}${formatDuration(movie.duration)} · ${movie.format.toUpperCase()}`,
      movie,
      activate: () => {
        navigate(`/movie/${movie.id}`);
        setOpen(false);
      },
    }));
  }, [navigate, query, results, setOpen]);

  useEffect(() => setActive(0), [items.length]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[active]?.activate();
    }
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette movie-palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-search-row">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search your movies…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="palette-results">
          <div className="palette-group">{query.trim() ? 'Movies' : 'Navigate'}</div>
          {items.length === 0 ? (
            <div className="palette-empty">No movies found.</div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.key}
                className={`palette-item ${index === active ? 'focused' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={item.activate}
              >
                {item.movie ? (
                  <img
                    className="movie-palette-thumb"
                    src={movieThumbnailUrl(item.movie.id)}
                    alt=""
                    loading="lazy"
                  />
                ) : item.icon === 'continue' ? (
                  <History size={19} />
                ) : (
                  <Clapperboard size={19} />
                )}
                <span className="palette-item-copy">
                  <strong>{item.label}</strong>
                  {item.sub && <small>{item.sub}</small>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
