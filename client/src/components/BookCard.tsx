import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Play } from 'lucide-react';
import { bookThumbnailUrl } from '../api.ts';
import type { Book } from '../types.ts';

export type BookViewMode = 'grid' | 'list';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BookGrid({
  books,
  view = 'grid',
}: {
  books: Book[];
  view?: BookViewMode;
}) {
  if (books.length === 0) return <div className="empty-state">No books found.</div>;
  return (
    <div className={`movie-grid ${view === 'list' ? 'is-list' : ''}`}>
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </div>
  );
}

export function BookCard({ book }: { book: Book }) {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const progress =
    book.pageCount > 0
      ? Math.min(100, Math.max(0, (book.resumePage / book.pageCount) * 100))
      : 0;

  return (
    <article
      className="movie-card book-card"
      onClick={() => navigate(`/book/read/${book.id}`)}
    >
      <div className="movie-card-image">
        {!failed ? (
          <img
            src={bookThumbnailUrl(book.id)}
            alt={book.title}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="movie-thumb-fallback">
            <BookOpen size={34} strokeWidth={1.4} />
          </div>
        )}
        <div className="movie-card-shade" />
        <div
          className="movie-card-play"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/book/read/${book.id}`);
          }}
        >
          <Play size={18} fill="currentColor" />
        </div>
        <span className="movie-format">{book.pageCount} p</span>
        {progress > 0 && (
          <div className="movie-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="movie-card-copy">
        <h3>{book.title}</h3>
        <p>{book.pageCount} pages · {formatSize(book.size)}</p>
      </div>
    </article>
  );
}
