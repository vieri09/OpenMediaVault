import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search as SearchIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { books, bookThumbnailUrl } from '../api.ts';
import type { Book } from '../types.ts';

interface BookCommandPaletteProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

interface PaletteItem {
  key: string;
  label: string;
  sub?: string;
  book?: Book;
  icon?: 'books';
  activate: () => void;
}

export default function BookCommandPalette({
  open,
  setOpen,
}: BookCommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Book[]>([]);
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
      books({ search, sort: 'title', order: 'asc', page: 1, limit: 12 })
        .then((page) => setResults(page.items))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(handle);
  }, [open, query]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!query.trim()) {
      return [
        {
          key: 'nav-books',
          label: 'Go to Books',
          icon: 'books',
          activate: () => {
            navigate('/book');
            setOpen(false);
          },
        },
      ];
    }
    return results.map((book) => ({
      key: book.id,
      label: book.title,
      sub: `${book.pageCount} pages · ${book.format.toUpperCase()}`,
      book,
      activate: () => {
        navigate(`/book/read/${book.id}`);
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
      <div className="palette book-palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-search-row">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search your books…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="palette-results">
          <div className="palette-group">{query.trim() ? 'Books' : 'Navigate'}</div>
          {items.length === 0 ? (
            <div className="palette-empty">No books found.</div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.key}
                className={`palette-item ${index === active ? 'focused' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={item.activate}
              >
                {item.book ? (
                  <img
                    className="movie-palette-thumb"
                    src={bookThumbnailUrl(item.book.id)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <BookOpen size={19} />
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
