import type {
  AlbumDetail,
  AlbumSortKey,
  ArtistDetail,
  Book,
  BookFolderPage,
  BookProgress,
  BookSortKey,
  BookSummary,
  Genre,
  LibrarySummary,
  Movie,
  MovieFolderPage,
  MovieProgress,
  MovieSortKey,
  MovieSummary,
  PageResult,
  ScanStatus,
  SearchResult,
  SortOrder,
  Track,
  TrackSortKey,
} from './types.ts';

// API base is relative ("/api") — proxied to the backend in dev, same-origin in prod.
const BASE = '/api';

function qs(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ── endpoints ──────────────────────────────────────────────────────
export const api = {
  summary: () => getJSON<LibrarySummary>('/library/summary'),
  scanStatus: () => getJSON<ScanStatus>('/scan/status'),
  rescan: () =>
    fetch(`${BASE}/rescan`, { method: 'POST' }).then((r) => r.json() as Promise<ScanStatus>),

  tracks: (opts: {
    sort?: TrackSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
    genre?: string;
  } = {}) => getJSON<PageResult<Track>>(`/tracks${qs(opts as Record<string, string | number | undefined>)}`),

  albums: (opts: {
    sort?: AlbumSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
  } = {}) => getJSON<PageResult<import('./types.ts').Album>>(`/albums${qs(opts as Record<string, string | number | undefined>)}`),

  albumDetail: (id: string) => getJSON<AlbumDetail>(`/albums/${id}`),
  artists: (opts: { order?: SortOrder; page?: number; limit?: number; search?: string } = {}) =>
    getJSON<PageResult<import('./types.ts').Artist>>(`/artists${qs(opts as Record<string, string | number | undefined>)}`),
  artistDetail: (id: string) => getJSON<ArtistDetail>(`/artists/${id}`),
  genres: () => getJSON<Genre[]>('/genres'),
  search: (q: string, limit = 25) => getJSON<SearchResult>(`/search${qs({ q, limit })}`),
  movieSummary: () => getJSON<MovieSummary>('/movies/summary'),
  movieScanStatus: () => getJSON<ScanStatus>('/movies/scan/status'),
  rescanMovies: () =>
    fetch(`${BASE}/movies/rescan`, { method: 'POST' }).then((response) => {
      if (!response.ok) throw new ApiError(response.status, response.statusText);
      return response.json() as Promise<ScanStatus>;
    }),
  movies: (opts: {
    sort?: MovieSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
  } = {}) =>
    getJSON<PageResult<Movie>>(
      `/movies${qs(opts as Record<string, string | number | undefined>)}`,
    ),
  movieFolder: (id = 'root') =>
    getJSON<MovieFolderPage>(id === 'root' ? '/movies/folders' : `/movies/folders/${id}`),
  continueWatching: (limit = 12) => getJSON<Movie[]>(`/movies/continue${qs({ limit })}`),
  movie: (id: string) => getJSON<Movie>(`/movies/${id}`),
  saveMovieProgress: async (id: string, position: number, duration: number) => {
    const response = await fetch(`${BASE}/movies/${id}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, duration }),
      keepalive: true,
    });
    if (!response.ok) throw new ApiError(response.status, response.statusText);
    return (await response.json()) as MovieProgress;
  },
  clearMovieProgress: async (id: string) => {
    const response = await fetch(`${BASE}/movies/${id}/progress`, { method: 'DELETE' });
    if (!response.ok) throw new ApiError(response.status, response.statusText);
  },
};

/** Stream URL for a track id (used as <audio src>). */
export const streamUrl = (id: string): string => `${BASE}/stream/${id}`;
/** Cover-art URL for a track id. */
export const coverUrl = (id: string): string => `${BASE}/cover/${id}`;
export const movieThumbnailUrl = (id: string): string => `${BASE}/movies/${id}/thumbnail`;
export const movieStreamUrl = (id: string): string => `${BASE}/movies/${id}/stream`;
export const movieHlsUrl = (
  id: string,
  start = 0,
  audioStreamIndex = -1,
  sourceVideo = false,
  playbackSessionId?: string,
): string =>
  `${BASE}/movies/${id}/hls/index.m3u8${qs({
    start: start > 0 ? Math.floor(start) : undefined,
    audio: audioStreamIndex >= 0 ? audioStreamIndex : undefined,
    video: sourceVideo ? 'source' : undefined,
    session: playbackSessionId,
  })}`;
export const movieSubtitleUrl = (
  id: string,
  streamIndex: number,
  start = 0,
  from = start,
): string =>
  `${BASE}/movies/${id}/subtitles/${streamIndex}.vtt${qs({
    start: start > 0 ? Math.floor(start) : undefined,
    from: from > 0 ? Math.floor(from) : undefined,
  })}`;
export const stopMovieHls = (id: string, playbackSessionId: string): Promise<Response> =>
  fetch(
    `${BASE}/movies/${id}/hls${qs({ session: playbackSessionId })}`,
    { method: 'DELETE', keepalive: true },
  );

// ── book API ──────────────────────────────────────────────────────
export const bookSummary = () => getJSON<BookSummary>('/books/summary');
export const bookScanStatus = () => getJSON<ScanStatus>('/books/scan/status');
export const rescanBooks = () =>
  fetch(`${BASE}/books/rescan`, { method: 'POST' }).then((r) => {
    if (!r.ok) throw new ApiError(r.status, r.statusText);
    return r.json() as Promise<ScanStatus>;
  });
export const books = (opts: {
  sort?: BookSortKey;
  order?: SortOrder;
  page?: number;
  limit?: number;
  search?: string;
} = {}) =>
  getJSON<PageResult<Book>>(
    `/books${qs(opts as Record<string, string | number | undefined>)}`,
  );
export const bookFolder = (id = 'root') =>
  getJSON<BookFolderPage>(id === 'root' ? '/books/folders' : `/books/folders/${id}`);
export const book = (id: string) => getJSON<Book>(`/books/${id}`);
export const bookFileUrl = (id: string): string => `${BASE}/books/${id}/file`;
export const bookThumbnailUrl = (id: string): string => `${BASE}/books/${id}/thumbnail`;
export const bookPageUrl = (id: string, page: number): string =>
  `${BASE}/books/${id}/page/${page}`;

export const continueReading = (limit = 12) =>
  getJSON<Book[]>(`/books/continue${qs({ limit })}`);

export const saveBookProgress = async (id: string, page: number) => {
  const response = await fetch(`${BASE}/books/${id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page }),
    keepalive: true,
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return (await response.json()) as BookProgress;
};

export const clearBookProgress = async (id: string) => {
  const response = await fetch(`${BASE}/books/${id}/progress`, { method: 'DELETE' });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
};
