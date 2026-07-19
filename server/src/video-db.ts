import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { trackId } from './keys.ts';
import type {
  Movie,
  MovieFolderPage,
  MovieMediaTrack,
  MoviePlaybackMode,
  MovieProgress,
  MovieSortKey,
  MovieSummary,
} from './video-types.ts';
import type { PageResult, SortOrder } from './types.ts';

export interface MovieRow {
  id: string;
  file_path: string;
  rel_path: string;
  title: string;
  folder: string;
  year: number | null;
  format: string;
  duration: number;
  video_codec: string;
  video_copyable: number;
  audio_codec: string;
  audio_tracks: string;
  subtitle_tracks: string;
  width: number;
  height: number;
  playback_mode: MoviePlaybackMode;
  size: number;
  mtime: number;
  date_added: number;
  scanned_at: number;
}

const VIDEO_SCHEMA = `
CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  rel_path TEXT NOT NULL,
  title TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  year INTEGER,
  format TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  video_codec TEXT NOT NULL DEFAULT '',
  video_copyable INTEGER NOT NULL DEFAULT 0,
  audio_codec TEXT NOT NULL DEFAULT '',
  audio_tracks TEXT NOT NULL DEFAULT '[]',
  subtitle_tracks TEXT NOT NULL DEFAULT '[]',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  playback_mode TEXT NOT NULL DEFAULT 'hls' CHECK (playback_mode IN ('direct','hls')),
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  date_added INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE INDEX IF NOT EXISTS idx_movies_date_added ON movies(date_added DESC);
CREATE INDEX IF NOT EXISTS idx_movies_folder ON movies(folder);

CREATE TABLE IF NOT EXISTS movie_progress (
  movie_id TEXT PRIMARY KEY,
  position REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(movie_id) REFERENCES movies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_movie_progress_updated ON movie_progress(updated_at DESC);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type PublicMovieRow = MovieRow & {
  resume_position: number | null;
  resume_duration: number | null;
  progress_updated_at: number | null;
};

const MOVIE_SELECT = `
  SELECT
    m.*,
    p.position AS resume_position,
    p.duration AS resume_duration,
    p.updated_at AS progress_updated_at
  FROM movies m
  LEFT JOIN movie_progress p ON p.movie_id = m.id
`;

const MOVIE_SORT: Record<MovieSortKey, string> = {
  title: 'm.title COLLATE NOCASE',
  recently_added: 'm.date_added',
  duration: 'm.duration',
  year: 'm.year',
};

const ROOT_FOLDER_ID = 'root';

function normalizeDirectory(value: string): string {
  const normalized = value.split(path.sep).join('/');
  return normalized === '.' ? '' : normalized.replace(/^\/+|\/+$/g, '');
}

function folderId(directory: string): string {
  return directory ? trackId(`movie-folder:${directory}`) : ROOT_FOLDER_ID;
}

function rowToMovie(row: PublicMovieRow): Movie {
  const parseTracks = (raw: string): MovieMediaTrack[] => {
    try {
      const parsed = JSON.parse(raw) as MovieMediaTrack[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    title: row.title,
    folder: row.folder,
    year: row.year,
    format: row.format,
    duration: row.duration,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    audioTracks: parseTracks(row.audio_tracks),
    subtitleTracks: parseTracks(row.subtitle_tracks),
    width: row.width,
    height: row.height,
    playbackMode: row.playback_mode,
    dateAdded: row.date_added,
    resumePosition: row.resume_position ?? 0,
    resumeDuration: row.resume_duration ?? 0,
    progressUpdatedAt: row.progress_updated_at,
  };
}

export class VideoDatabase {
  private readonly db: Database.Database;
  private readonly stUpsert: Database.Statement<unknown[]>;
  private readonly stGetById: Database.Statement<[string]>;
  private readonly stGetByPath: Database.Statement<[string]>;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(VIDEO_SCHEMA);
    const movieColumns = new Set(
      (this.db.prepare('PRAGMA table_info(movies)').all() as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    if (!movieColumns.has('audio_tracks')) {
      this.db.exec("ALTER TABLE movies ADD COLUMN audio_tracks TEXT NOT NULL DEFAULT '[]'");
    }
    if (!movieColumns.has('subtitle_tracks')) {
      this.db.exec("ALTER TABLE movies ADD COLUMN subtitle_tracks TEXT NOT NULL DEFAULT '[]'");
    }
    if (!movieColumns.has('video_copyable')) {
      this.db.exec('ALTER TABLE movies ADD COLUMN video_copyable INTEGER NOT NULL DEFAULT 0');
    }

    this.stUpsert = this.db.prepare(`
      INSERT INTO movies (
        id, file_path, rel_path, title, folder, year, format, duration,
        video_codec, video_copyable, audio_codec, audio_tracks, subtitle_tracks, width, height, playback_mode,
        size, mtime, date_added, scanned_at
      ) VALUES (
        @id, @file_path, @rel_path, @title, @folder, @year, @format, @duration,
        @video_codec, @video_copyable, @audio_codec, @audio_tracks, @subtitle_tracks, @width, @height, @playback_mode,
        @size, @mtime, @date_added, @scanned_at
      )
      ON CONFLICT(id) DO UPDATE SET
        file_path=excluded.file_path,
        rel_path=excluded.rel_path,
        title=excluded.title,
        folder=excluded.folder,
        year=excluded.year,
        format=excluded.format,
        duration=excluded.duration,
        video_codec=excluded.video_codec,
        video_copyable=excluded.video_copyable,
        audio_codec=excluded.audio_codec,
        audio_tracks=excluded.audio_tracks,
        subtitle_tracks=excluded.subtitle_tracks,
        width=excluded.width,
        height=excluded.height,
        playback_mode=excluded.playback_mode,
        size=excluded.size,
        mtime=excluded.mtime,
        scanned_at=excluded.scanned_at
    `);
    this.stGetById = this.db.prepare('SELECT * FROM movies WHERE id = ?');
    this.stGetByPath = this.db.prepare('SELECT * FROM movies WHERE file_path = ?');
  }

  upsert(row: MovieRow): void {
    this.stUpsert.run(row);
  }

  getRowById(id: string): MovieRow | undefined {
    return this.stGetById.get(id) as MovieRow | undefined;
  }

  getRowByPath(filePath: string): MovieRow | undefined {
    return this.stGetByPath.get(filePath) as MovieRow | undefined;
  }

  getMovie(id: string): Movie | undefined {
    const row = this.db.prepare(`${MOVIE_SELECT} WHERE m.id = ?`).get(id) as
      | PublicMovieRow
      | undefined;
    return row ? rowToMovie(row) : undefined;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM movies').get() as { n: number }).n;
  }

  list(opts: {
    sort?: MovieSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
  } = {}): PageResult<Movie> {
    const sort = MOVIE_SORT[opts.sort ?? 'recently_added'] ?? MOVIE_SORT.recently_added;
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 36));
    const offset = (page - 1) * limit;
    const params: Record<string, unknown> = { limit, offset };
    const where = opts.search ? 'WHERE LOWER(m.title) LIKE @query OR LOWER(m.folder) LIKE @query' : '';
    if (opts.search) params.query = `%${opts.search.toLowerCase()}%`;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM movies m ${where}`).get(params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `${MOVIE_SELECT}
         ${where}
         ORDER BY ${sort} ${order}, m.title COLLATE NOCASE ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params) as PublicMovieRow[];

    return {
      items: rows.map(rowToMovie),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  browseFolder(requestedId = ROOT_FOLDER_ID): MovieFolderPage | null {
    const rows = this.db
      .prepare(`${MOVIE_SELECT} ORDER BY m.title COLLATE NOCASE ASC`)
      .all() as PublicMovieRow[];
    const directoryIds = new Map<string, string>([[ROOT_FOLDER_ID, '']]);

    for (const row of rows) {
      const directory = normalizeDirectory(path.dirname(row.rel_path));
      if (!directory) continue;
      const parts = directory.split('/');
      for (let index = 1; index <= parts.length; index++) {
        const value = parts.slice(0, index).join('/');
        directoryIds.set(folderId(value), value);
      }
    }

    const currentDirectory = directoryIds.get(requestedId);
    if (currentDirectory === undefined) return null;

    const childFolders = new Map<
      string,
      {
        directory: string;
        name: string;
        movieCount: number;
        subfolders: Set<string>;
        thumbnailMovieId: string | null;
      }
    >();
    const movies: Movie[] = [];

    for (const row of rows) {
      const rowDirectory = normalizeDirectory(path.dirname(row.rel_path));
      const relativeDirectory = currentDirectory
        ? path.posix.relative(currentDirectory, rowDirectory)
        : rowDirectory;
      if (relativeDirectory.startsWith('..')) continue;

      if (!relativeDirectory) {
        movies.push(rowToMovie(row));
        continue;
      }

      const childName = relativeDirectory.split('/')[0];
      const childDirectory = currentDirectory
        ? `${currentDirectory}/${childName}`
        : childName;
      const child = childFolders.get(childDirectory) ?? {
        directory: childDirectory,
        name: childName,
        movieCount: 0,
        subfolders: new Set<string>(),
        thumbnailMovieId: null,
      };
      child.movieCount++;
      const nestedName = relativeDirectory.split('/')[1];
      if (nestedName) child.subfolders.add(nestedName);
      child.thumbnailMovieId ??= row.id;
      childFolders.set(childDirectory, child);
    }

    const parts = currentDirectory ? currentDirectory.split('/') : [];
    const breadcrumbs = [
      { id: ROOT_FOLDER_ID, name: 'Movies' },
      ...parts.map((name, index) => {
        const directory = parts.slice(0, index + 1).join('/');
        return { id: folderId(directory), name };
      }),
    ];

    return {
      current: breadcrumbs[breadcrumbs.length - 1],
      breadcrumbs,
      folders: [...childFolders.values()]
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        .map((folder) => ({
          id: folderId(folder.directory),
          name: folder.name,
          movieCount: folder.movieCount,
          subfolderCount: folder.subfolders.size,
          thumbnailMovieId: folder.thumbnailMovieId,
        })),
      movies: movies.sort((left, right) =>
        left.title.localeCompare(right.title, undefined, { numeric: true }),
      ),
    };
  }

  continueWatching(limit = 12): Movie[] {
    const rows = this.db
      .prepare(
        `${MOVIE_SELECT}
         WHERE p.position >= 30
           AND p.duration > 0
           AND p.position < p.duration * 0.95
         ORDER BY p.updated_at DESC
         LIMIT ?`,
      )
      .all(Math.min(50, Math.max(1, limit))) as PublicMovieRow[];
    return rows.map(rowToMovie);
  }

  saveProgress(movieId: string, position: number, duration: number): MovieProgress | null {
    const movie = this.getRowById(movieId);
    if (!movie) return null;

    const safeDuration = Math.max(0, Math.min(duration || movie.duration, movie.duration || duration));
    const safePosition = Math.max(0, Math.min(position, safeDuration || movie.duration));
    if (
      safePosition < 5 ||
      (safeDuration > 0 && (safePosition >= safeDuration - 30 || safePosition / safeDuration >= 0.95))
    ) {
      this.db.prepare('DELETE FROM movie_progress WHERE movie_id = ?').run(movieId);
      return {
        movieId,
        position: 0,
        duration: safeDuration,
        updatedAt: Date.now(),
      };
    }

    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO movie_progress (movie_id, position, duration, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(movie_id) DO UPDATE SET
           position=excluded.position,
           duration=excluded.duration,
           updated_at=excluded.updated_at`,
      )
      .run(movieId, safePosition, safeDuration, updatedAt);
    return { movieId, position: safePosition, duration: safeDuration, updatedAt };
  }

  clearProgress(movieId: string): void {
    this.db.prepare('DELETE FROM movie_progress WHERE movie_id = ?').run(movieId);
  }

  pruneMissing(keepPaths: Set<string>): number {
    const rows = this.db.prepare('SELECT id, file_path FROM movies').all() as {
      id: string;
      file_path: string;
    }[];
    const remove = this.db.prepare('DELETE FROM movies WHERE id = ?');
    let removed = 0;
    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        if (!keepPaths.has(row.file_path)) {
          remove.run(row.id);
          removed++;
        }
      }
    });
    transaction();
    return removed;
  }

  summary(configured: boolean, ffmpegAvailable: boolean): MovieSummary {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS movieCount,
          COALESCE(SUM(duration), 0) AS totalDuration,
          SUM(CASE WHEN playback_mode = 'direct' THEN 1 ELSE 0 END) AS directPlayCount,
          SUM(CASE WHEN playback_mode = 'hls' THEN 1 ELSE 0 END) AS transcodeCount
         FROM movies`,
      )
      .get() as {
      movieCount: number;
      totalDuration: number;
      directPlayCount: number | null;
      transcodeCount: number | null;
    };
    return {
      configured,
      ffmpegAvailable,
      movieCount: row.movieCount,
      totalDurationSeconds: row.totalDuration,
      directPlayCount: row.directPlayCount ?? 0,
      transcodeCount: row.transcodeCount ?? 0,
    };
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
