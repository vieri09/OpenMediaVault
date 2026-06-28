/** Shared domain types used across the backend API. */

export interface Track {
  id: string;
  /** Path relative to the music library root. */
  relPath: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: number | null;
  /** Duration in seconds. */
  duration: number;
  trackNumber: number | null;
  discNumber: number | null;
  hasCover: boolean;
  /** File extension without the dot, lower-cased. */
  format: string;
  /** File size in bytes. */
  size: number;
  /** Unix epoch (ms) the file was last modified. */
  mtime: number;
  /** Unix epoch (ms) the track was first scanned. */
  dateAdded: number;
}

export interface Album {
  id: string;
  title: string;
  albumArtist: string;
  year: number | null;
  genre: string;
  trackCount: number;
  duration: number;
  /** Date added = earliest dateAdded among the album's tracks. */
  dateAdded: number;
  /** True if any track in the album has embedded cover art. */
  hasCover: boolean;
  /** A representative track id used to fetch cover art. */
  coverTrackId: string | null;
}

export interface AlbumDetail extends Album {
  tracks: Track[];
}

export interface Artist {
  id: string;
  name: string;
  trackCount: number;
  albumCount: number;
  duration: number;
}

export interface ArtistDetail extends Artist {
  albums: Album[];
  tracks: Track[];
}

export interface Genre {
  name: string;
  trackCount: number;
  albumCount: number;
}

export interface LibrarySummary {
  trackCount: number;
  albumCount: number;
  artistCount: number;
  genreCount: number;
  totalDurationSeconds: number;
  configured: boolean;
  libraryPath: string;
}

export type SortOrder = 'asc' | 'desc';

export type AlbumSortKey = 'title' | 'artist' | 'year' | 'recently_added';
export type TrackSortKey = 'title' | 'artist' | 'album' | 'duration' | 'date_added';

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ScanResult {
  total: number;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  errors: ScanError[];
  durationMs: number;
}

export interface ScanError {
  path: string;
  message: string;
}

export interface ScanStatus {
  scanning: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  processed: number;
  lastResult: ScanResult | null;
}
