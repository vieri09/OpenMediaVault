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
