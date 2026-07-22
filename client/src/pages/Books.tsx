import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  BookOpen,
  ChevronRight,
  Folder,
  FolderTree,
  LayoutGrid,
  List,
  Search,
} from 'lucide-react';
import { bookSummary, bookFolder, books, bookThumbnailUrl } from '../api.ts';
import { Loading, PageHeader } from '../components/common.tsx';
import { BookCard } from '../components/BookCard.tsx';
import type { Book } from '../types.ts';

const PAGE_SIZE = 36;
const BOOK_VIEW_KEY = 'openmedia-book-view';

function plural(count: number, word: string): string {
  return `${count} ${word}${count !== 1 ? 's' : ''}`;
}

export default function BooksPage() {
  const { folderId = 'root' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(BOOK_VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const search = searchParams.get('search') ?? '';
  const normalizedSearch = search.trim();

  const { data: summary, error: summaryError } = useSWR('/api/books/summary', bookSummary);
  const { data: folder, error: folderError } = useSWR(
    normalizedSearch ? null : `/api/books/folders/${folderId}`,
    () => bookFolder(folderId),
  );
  const { data: searchResults, error: searchError } = useSWR(
    normalizedSearch
      ? ['/api/books', 'title', 'asc', page, normalizedSearch]
      : null,
    () =>
      books({
        sort: 'title',
        order: 'asc',
        page,
        limit: PAGE_SIZE,
        search: normalizedSearch,
      }),
  );

  useEffect(() => setPage(1), [folderId, normalizedSearch]);
  useEffect(() => {
    try {
      localStorage.setItem(BOOK_VIEW_KEY, view);
    } catch {
      // Browsing works even when storage is disabled.
    }
  }, [view]);

  if (summaryError) return <div className="error">Could not load the book library.</div>;
  if (!summary) return <Loading />;

  if (!summary.configured) {
    return (
      <div className="content">
        <div className="empty-state">
          <BookOpen size={42} strokeWidth={1.3} />
          <h2>Add your book folder</h2>
          <p className="muted">
            Set <code>BOOK_LIBRARY_PATH</code> in the root <code>.env</code>, restart
            OpenMedia, then scan your books.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="content movies-content">
      <PageHeader
        title={normalizedSearch ? 'Search Results' : folder?.current.name ?? 'Books'}
        subtitle={`${plural(summary.bookCount, 'book')} · ${plural(summary.totalPages, 'page')}`}
      />

      {!normalizedSearch && folder && (
        <nav className="movie-breadcrumbs" aria-label="Book folders">
          {folder.breadcrumbs.map((crumb, index) => (
            <span key={crumb.id}>
              {index > 0 && <ChevronRight size={14} />}
              <Link to={crumb.id === 'root' ? '/book' : `/book/folder/${crumb.id}`}>
                {crumb.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <div className="movie-library-heading">
        <h2 className="section-title">
          {normalizedSearch ? `Results for "${normalizedSearch}"` : 'Browse'}
        </h2>
        <div className="movie-filters">
          <label className="movie-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => {
                const value = event.target.value;
                setSearchParams(value ? { search: value } : {}, { replace: true });
              }}
              placeholder="Search books…"
              aria-label="Search books"
            />
          </label>
          <div className="movie-view-toggle" role="group" aria-label="Book view">
            <button
              type="button"
              className={view === 'grid' ? 'active' : ''}
              onClick={() => setView('grid')}
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={view === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
              aria-label="List view"
              aria-pressed={view === 'list'}
              title="List view"
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>

      {(folderError || searchError) ? (
        <div className="error">Could not load books.</div>
      ) : normalizedSearch && !searchResults ? (
        <Loading />
      ) : !normalizedSearch && !folder ? (
        <Loading />
      ) : summary.bookCount === 0 ? (
        <div className="empty-state">
          <h2>No books indexed yet</h2>
          <p className="muted">Press "Rescan Books" in the sidebar to index your CBZ files.</p>
        </div>
      ) : (
        <>
          {/* Folder listing */}
          {!normalizedSearch && folder && folder.folders.length > 0 && (
            <div className={`movie-folder-grid ${view === 'list' ? 'is-list' : ''}`}>
              {folder.folders.map((entry) => (
                <Link
                  key={entry.id}
                  to={`/book/folder/${entry.id}`}
                  className={`movie-folder-card ${
                    entry.subfolderCount > 0 ? 'has-subfolders' : ''
                  }`}
                >
                  <div className="movie-folder-image">
                    {entry.thumbnailBookId ? (
                      <img
                        src={bookThumbnailUrl(entry.thumbnailBookId)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      entry.subfolderCount > 0
                        ? <FolderTree size={38} />
                        : <Folder size={34} />
                    )}
                    <span>
                      {entry.subfolderCount > 0
                        ? <FolderTree size={16} />
                        : <Folder size={16} />}
                      {entry.subfolderCount > 0 ? 'Collection' : 'Folder'}
                    </span>
                  </div>
                  <div className="movie-folder-copy">
                    <h3>{entry.name}</h3>
                    <p>
                      {entry.subfolderCount > 0 && (
                        <strong>{plural(entry.subfolderCount, 'subfolder')}</strong>
                      )}
                      {entry.subfolderCount > 0 && ' · '}
                      {plural(entry.bookCount, 'book')}
                    </p>
                  </div>
                  <ChevronRight className="movie-folder-arrow" size={18} />
                </Link>
              ))}
            </div>
          )}

          {/* Book listing */}
          {(normalizedSearch
            ? (searchResults?.items.length ?? 0) > 0
            : (folder?.books.length ?? 0) > 0) && (
            <div className={`movie-grid ${view === 'list' ? 'is-list' : ''}`}>
              {(normalizedSearch ? searchResults?.items ?? [] : folder?.books ?? []).map((book: Book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          )}

          {/* Empty folder */}
          {!normalizedSearch &&
            folder &&
            folder.folders.length === 0 &&
            folder.books.length === 0 && (
              <div className="empty-state">This folder contains no indexed books.</div>
            )}

          {/* Search empty */}
          {normalizedSearch && searchResults?.items.length === 0 && (
            <div className="empty-state">No books found.</div>
          )}

          {/* Search pagination */}
          {normalizedSearch && searchResults && searchResults.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
                Previous
              </button>
              <span>Page {searchResults.page} of {searchResults.totalPages}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= searchResults.totalPages}
                onClick={() => setPage((v) => v + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
