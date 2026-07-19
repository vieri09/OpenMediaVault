// Domain types mirroring the backend API shapes.

export interface Track {
  id: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: number | null;
  duration: number;
  trackNumber: number | null;
  discNumber: number | null;
  hasCover: boolean;
}

export interface Album {
  id: string;
  title: string;
  albumArtist: string;
  year: number | null;
  genre: string;
  trackCount: number;
  duration: number;
  dateAdded: number;
  hasCover: boolean;
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
  errors: { path: string; message: string }[];
  durationMs: number;
}

export interface ScanStatus {
  scanning: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  processed: number;
  lastResult: ScanResult | null;
  message?: string;
}

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export type RepeatMode = 'off' | 'all' | 'one';

export type MoviePlaybackMode = 'direct' | 'hls';
export type MovieSortKey = 'title' | 'recently_added' | 'duration' | 'year';

export interface MovieMediaTrack {
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
}

export interface Movie {
  id: string;
  title: string;
  folder: string;
  year: number | null;
  format: string;
  duration: number;
  videoCodec: string;
  audioCodec: string;
  audioTracks: MovieMediaTrack[];
  subtitleTracks: MovieMediaTrack[];
  width: number;
  height: number;
  playbackMode: MoviePlaybackMode;
  dateAdded: number;
  resumePosition: number;
  resumeDuration: number;
  progressUpdatedAt: number | null;
}

export interface MovieSummary {
  configured: boolean;
  movieCount: number;
  totalDurationSeconds: number;
  directPlayCount: number;
  transcodeCount: number;
  ffmpegAvailable: boolean;
}

export interface MovieProgress {
  movieId: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface MovieFolder {
  id: string;
  name: string;
  movieCount: number;
  subfolderCount: number;
  thumbnailMovieId: string | null;
}

export interface MovieFolderCrumb {
  id: string;
  name: string;
}

export interface MovieFolderPage {
  current: MovieFolderCrumb;
  breadcrumbs: MovieFolderCrumb[];
  folders: MovieFolder[];
  movies: Movie[];
}

/** A queue entry carries a track plus the context it came from (for display). */
export interface QueueItem {
  track: Track;
}
