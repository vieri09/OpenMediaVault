import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  ChevronRight,
  Clapperboard,
  Folder,
  FolderTree,
  LayoutGrid,
  List,
  Search,
} from 'lucide-react';
import { api, movieThumbnailUrl } from '../api.ts';
import { MovieGrid, type MovieViewMode } from '../components/MovieCard.tsx';
import { Loading, PageHeader } from '../components/common.tsx';
import { formatDuration, plural } from '../lib/format.ts';

const PAGE_SIZE = 36;
const MOVIE_VIEW_KEY = 'openmedia-movie-view';

export default function Movies() {
  const { folderId = 'root' } = useParams();
  const [page, setPage] = useState(1);
  const [view, setView] = useState<MovieViewMode>(() => {
    try {
      return localStorage.getItem(MOVIE_VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const normalizedSearch = search.trim();

  const { data: summary, error: summaryError } = useSWR('/api/movies/summary', api.movieSummary);
  const { data: folder, error: folderError } = useSWR(
    normalizedSearch ? null : `/api/movies/folders/${folderId}`,
    () => api.movieFolder(folderId),
  );
  const { data: searchResults, error: searchError } = useSWR(
    normalizedSearch
      ? ['/api/movies', 'title', 'asc', page, normalizedSearch]
      : null,
    () =>
      api.movies({
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
      localStorage.setItem(MOVIE_VIEW_KEY, view);
    } catch {
      // Browsing still works when storage is disabled.
    }
  }, [view]);

  if (summaryError) return <div className="error">Could not load the movie library.</div>;
  if (!summary) return <Loading />;

  if (!summary.configured) {
    return (
      <div className="content">
        <div className="empty-state">
          <Clapperboard size={42} strokeWidth={1.3} />
          <h2>Add your movie folder</h2>
          <p className="muted">
            Set <code>MOVIE_LIBRARY_PATH</code> in the root <code>.env</code>, restart
            OpenMedia, then scan your movies.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="content movies-content">
      <PageHeader
        title={normalizedSearch ? 'Search Results' : folder?.current.name ?? 'Movies'}
        subtitle={`${plural(summary.movieCount, 'movie')} · ${formatDuration(summary.totalDurationSeconds)}`}
      />

      {!normalizedSearch && folder && (
        <nav className="movie-breadcrumbs" aria-label="Movie folders">
          {folder.breadcrumbs.map((crumb, index) => (
            <span key={crumb.id}>
              {index > 0 && <ChevronRight size={14} />}
              <Link to={crumb.id === 'root' ? '/movie' : `/movie/folder/${crumb.id}`}>
                {crumb.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <div className="movie-library-heading">
        <h2 className="section-title">
          {normalizedSearch ? `Results for “${normalizedSearch}”` : 'Browse by folder'}
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
              placeholder="Search movies…"
              aria-label="Search movies"
            />
          </label>
          <div className="movie-view-toggle" role="group" aria-label="Movie view">
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
        <div className="error">Could not load movies.</div>
      ) : normalizedSearch && !searchResults ? (
        <Loading />
      ) : !normalizedSearch && !folder ? (
        <Loading />
      ) : summary.movieCount === 0 ? (
        <div className="empty-state">
          <h2>No movies indexed yet</h2>
          <p className="muted">Press “Scan movies” to index MP4, MKV, M4V and AVI files.</p>
        </div>
      ) : (
        <>
          {!normalizedSearch && folder && folder.folders.length > 0 && (
            <div className={`movie-folder-grid ${view === 'list' ? 'is-list' : ''}`}>
              {folder.folders.map((entry) => (
                <Link
                  key={entry.id}
                  to={`/movie/folder/${entry.id}`}
                  className={`movie-folder-card ${
                    entry.subfolderCount > 0 ? 'has-subfolders' : ''
                  }`}
                >
                  <div className="movie-folder-image">
                    {entry.thumbnailMovieId ? (
                      <img
                        src={movieThumbnailUrl(entry.thumbnailMovieId)}
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
                      {plural(entry.movieCount, 'video')}
                    </p>
                  </div>
                  <ChevronRight className="movie-folder-arrow" size={18} />
                </Link>
              ))}
            </div>
          )}
          {(normalizedSearch
            ? (searchResults?.items.length ?? 0) > 0
            : (folder?.movies.length ?? 0) > 0) && (
            <MovieGrid
              movies={normalizedSearch ? searchResults?.items ?? [] : folder?.movies ?? []}
              view={view}
            />
          )}
          {!normalizedSearch &&
            folder &&
            folder.folders.length === 0 &&
            folder.movies.length === 0 && (
              <div className="empty-state">This folder contains no indexed videos.</div>
            )}
          {normalizedSearch && searchResults?.items.length === 0 && (
            <div className="empty-state">No movies found.</div>
          )}
          {normalizedSearch && searchResults && searchResults.totalPages > 1 && (
            <div className="pagination">
              <button className="btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </button>
              <span>Page {searchResults.page} of {searchResults.totalPages}</span>
              <button
                className="btn"
                disabled={page >= searchResults.totalPages}
                onClick={() => setPage((value) => value + 1)}
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
