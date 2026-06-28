import type {
  AlbumDetail,
  AlbumSortKey,
  ArtistDetail,
  Genre,
  LibrarySummary,
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
};

/** Stream URL for a track id (used as <audio src>). */
export const streamUrl = (id: string): string => `${BASE}/stream/${id}`;
/** Cover-art URL for a track id. */
export const coverUrl = (id: string): string => `${BASE}/cover/${id}`;
