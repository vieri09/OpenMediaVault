import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Album,
  AlbumDetail,
  AlbumSortKey,
  Artist,
  ArtistDetail,
  Genre,
  LibrarySummary,
  PageResult,
  SortOrder,
  Track,
  TrackSortKey,
} from './types.ts';

/** Raw row shape persisted in SQLite. */
export interface TrackRow {
  id: string;
  file_path: string;
  rel_path: string;
  title: string;
  artist: string;
  album_artist: string;
  album: string;
  genre: string;
  year: number | null;
  duration: number;
  track_no: number | null;
  disc_no: number | null;
  has_cover: number;
  format: string;
  size: number;
  mtime: number;
  album_key: string;
  artist_key: string;
  effective_artist: string;
  date_added: number;
  scanned_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  rel_path TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  album_artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  year INTEGER,
  duration REAL NOT NULL DEFAULT 0,
  track_no INTEGER,
  disc_no INTEGER,
  has_cover INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  album_key TEXT NOT NULL DEFAULT '',
  artist_key TEXT NOT NULL DEFAULT '',
  effective_artist TEXT NOT NULL DEFAULT '',
  date_added INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tracks_album_key ON tracks(album_key);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_key ON tracks(artist_key);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added);
CREATE INDEX IF NOT EXISTS idx_tracks_has_cover ON tracks(album_key, has_cover);

-- Key/value store for cache metadata, e.g. which library root the cached
-- tracks were scanned from. Lets the server detect a MUSIC_LIBRARY_PATH change
-- and rescan instead of serving a stale cache built from a different folder.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function rowToTrack(r: TrackRow): Track {
  return {
    id: r.id,
    relPath: r.rel_path,
    title: r.title,
    artist: r.artist,
    albumArtist: r.album_artist,
    album: r.album,
    genre: r.genre,
    year: r.year,
    duration: r.duration,
    trackNumber: r.track_no,
    discNumber: r.disc_no,
    hasCover: r.has_cover === 1,
    format: r.format,
    size: r.size,
    mtime: r.mtime,
    dateAdded: r.date_added,
  };
}

/** Whitelisted sort columns — user input is never interpolated into SQL. */
const ALBUM_SORT: Record<AlbumSortKey, string> = {
  title: 'title COLLATE NOCASE',
  artist: 'albumArtist COLLATE NOCASE',
  year: 'year',
  recently_added: 'dateAdded',
};

const TRACK_SORT: Record<TrackSortKey, string> = {
  title: 'title COLLATE NOCASE',
  artist: 'artist COLLATE NOCASE',
  album: 'album COLLATE NOCASE',
  duration: 'duration',
  date_added: 'dateAdded',
};

export class LibraryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this.prepareStatements();
  }

  // ── prepared statements ──────────────────────────────────────────
  private stUpsert!: Database.Statement<unknown[]>;
  private stGetByPath!: Database.Statement<[string]>;
  private stGetById!: Database.Statement<[string]>;
  private stDeleteById!: Database.Statement<[string]>;
  private stCount!: Database.Statement<[]>;
  private stGetMeta!: Database.Statement<[string]>;
  private stSetMeta!: Database.Statement<[string, string]>;

  private prepareStatements(): void {
    this.stUpsert = this.db.prepare(`
      INSERT INTO tracks (
        id, file_path, rel_path, title, artist, album_artist, album, genre,
        year, duration, track_no, disc_no, has_cover, format, size, mtime,
        album_key, artist_key, effective_artist, date_added, scanned_at
      ) VALUES (
        @id, @file_path, @rel_path, @title, @artist, @album_artist, @album, @genre,
        @year, @duration, @track_no, @disc_no, @has_cover, @format, @size, @mtime,
        @album_key, @artist_key, @effective_artist, @date_added, @scanned_at
      )
      ON CONFLICT(id) DO UPDATE SET
        file_path=excluded.file_path,
        rel_path=excluded.rel_path,
        title=excluded.title,
        artist=excluded.artist,
        album_artist=excluded.album_artist,
        album=excluded.album,
        genre=excluded.genre,
        year=excluded.year,
        duration=excluded.duration,
        track_no=excluded.track_no,
        disc_no=excluded.disc_no,
        has_cover=excluded.has_cover,
        format=excluded.format,
        size=excluded.size,
        mtime=excluded.mtime,
        album_key=excluded.album_key,
        artist_key=excluded.artist_key,
        effective_artist=excluded.effective_artist,
        scanned_at=excluded.scanned_at
    `);

    this.stGetByPath = this.db.prepare('SELECT * FROM tracks WHERE file_path = ?');
    this.stGetById = this.db.prepare('SELECT * FROM tracks WHERE id = ?');
    this.stDeleteById = this.db.prepare('DELETE FROM tracks WHERE id = ?');
    this.stCount = this.db.prepare('SELECT COUNT(*) AS n FROM tracks');
    this.stGetMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    this.stSetMeta = this.db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
  }

  upsertTrack(row: TrackRow): void {
    this.stUpsert.run(row);
  }

  getByPath(absPath: string): TrackRow | undefined {
    return this.stGetByPath.get(absPath) as TrackRow | undefined;
  }

  getById(id: string): TrackRow | undefined {
    return this.stGetById.get(id) as TrackRow | undefined;
  }

  deleteById(id: string): void {
    this.stDeleteById.run(id);
  }

  count(): number {
    return (this.stCount.get() as { n: number }).n;
  }

  getMeta(key: string): string | undefined {
    const row = this.stGetMeta.get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.stSetMeta.run(key, value);
  }

  /** Delete tracks whose absolute path is not in `keepPaths`. Returns count removed. */
  pruneMissing(keepPaths: Set<string>): number {
    const all = this.db.prepare('SELECT id, file_path FROM tracks').all() as {
      id: string;
      file_path: string;
    }[];
    let removed = 0;
    const del = this.db.prepare('DELETE FROM tracks WHERE id = ?');
    const tx = this.db.transaction((rows: { id: string; file_path: string }[]) => {
      for (const r of rows) {
        if (!keepPaths.has(r.file_path)) {
          del.run(r.id);
          removed++;
        }
      }
    });
    tx(all);
    return removed;
  }

  private paginate<T>(items: T[], total: number, page: number, limit: number): PageResult<T> {
    const totalPages = limit > 0 ? Math.ceil(total / limit) || 1 : 1;
    return { items, total, page, limit, totalPages };
  }

  // ── tracks ───────────────────────────────────────────────────────
  listTracks(opts: {
    sort?: TrackSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
    genre?: string;
  } = {}): PageResult<Track> {
    const sort = TRACK_SORT[opts.sort ?? 'title'] ?? TRACK_SORT.title;
    const order = opts.order === 'desc' ? 'DESC' : 'ASC';
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.search) {
      where.push('(LOWER(title) LIKE @q OR LOWER(artist) LIKE @q OR LOWER(album) LIKE @q OR LOWER(album_artist) LIKE @q)');
      params.q = `%${opts.search.toLowerCase()}%`;
    }
    if (opts.genre) {
      where.push('LOWER(genre) = @genre');
      params.genre = opts.genre.toLowerCase();
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM tracks ${whereSql}`).get(params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `SELECT * FROM tracks ${whereSql} ORDER BY ${sort} ${order}, title COLLATE NOCASE ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as TrackRow[];

    return this.paginate(rows.map(rowToTrack), total, page, limit);
  }

  // ── albums ───────────────────────────────────────────────────────
  private albumSelect(whereSql: string): string {
    return `
      SELECT
        album_key AS id,
        COALESCE(NULLIF(album,''),'Unknown Album') AS title,
        COALESCE(NULLIF(effective_artist,''),'Unknown Artist') AS albumArtist,
        MAX(year) AS year,
        MAX(NULLIF(genre,'')) AS genre,
        COUNT(*) AS trackCount,
        SUM(duration) AS duration,
        MIN(date_added) AS dateAdded,
        MAX(has_cover) AS hasCover,
        (
          SELECT c.id FROM tracks c
          WHERE c.album_key = tracks.album_key AND c.has_cover = 1
          ORDER BY COALESCE(c.disc_no,1), COALESCE(c.track_no,1) LIMIT 1
        ) AS coverTrackId
      FROM tracks
      ${whereSql}
      GROUP BY album_key`;
  }

  listAlbums(opts: {
    sort?: AlbumSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
  } = {}): PageResult<Album> {
    const sort = ALBUM_SORT[opts.sort ?? 'title'] ?? ALBUM_SORT.title;
    const order = opts.order === 'desc' ? 'DESC' : 'ASC';
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;

    let whereSql = '';
    const params: Record<string, unknown> = {};
    if (opts.search) {
      whereSql = 'WHERE LOWER(album) LIKE @q OR LOWER(effective_artist) LIKE @q';
      params.q = `%${opts.search.toLowerCase()}%`;
    }

    const inner = this.albumSelect(whereSql);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM (${inner})`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM (${inner}) AS a ORDER BY ${sort} ${order} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset }) as (Omit<Album, 'hasCover'> & { hasCover: number })[];

    const items: Album[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      albumArtist: r.albumArtist,
      year: r.year,
      genre: r.genre ?? '',
      trackCount: r.trackCount,
      duration: r.duration,
      dateAdded: r.dateAdded,
      hasCover: r.hasCover === 1,
      coverTrackId: r.coverTrackId,
    }));
    return this.paginate(items, total, page, limit);
  }

  getAlbumDetail(albumId: string): AlbumDetail | undefined {
    const base = this.db
      .prepare(`SELECT * FROM (${this.albumSelect('WHERE album_key = @id')}) AS a`)
      .get({ id: albumId }) as
      | (Omit<Album, 'hasCover'> & { hasCover: number })
      | undefined;
    if (!base) return undefined;
    const rows = this.db
      .prepare(
        `SELECT * FROM tracks WHERE album_key = ? ORDER BY COALESCE(disc_no,1), COALESCE(track_no,1), title COLLATE NOCASE`,
      )
      .all(albumId) as TrackRow[];
    return {
      id: base.id,
      title: base.title,
      albumArtist: base.albumArtist,
      year: base.year,
      genre: base.genre ?? '',
      trackCount: base.trackCount,
      duration: base.duration,
      dateAdded: base.dateAdded,
      hasCover: base.hasCover === 1,
      coverTrackId: base.coverTrackId,
      tracks: rows.map(rowToTrack),
    };
  }

  // ── artists ──────────────────────────────────────────────────────
  private artistSelect(whereSql: string): string {
    return `
      SELECT
        artist_key AS id,
        COALESCE(NULLIF(effective_artist,''),'Unknown Artist') AS name,
        COUNT(*) AS trackCount,
        COUNT(DISTINCT album_key) AS albumCount,
        SUM(duration) AS duration
      FROM tracks
      ${whereSql}
      GROUP BY artist_key`;
  }

  listArtists(opts: {
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
  } = {}): PageResult<Artist> {
    const order = opts.order === 'desc' ? 'DESC' : 'ASC';
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const offset = (page - 1) * limit;

    let whereSql = '';
    const params: Record<string, unknown> = {};
    if (opts.search) {
      whereSql = 'WHERE LOWER(effective_artist) LIKE @q';
      params.q = `%${opts.search.toLowerCase()}%`;
    }
    const inner = this.artistSelect(whereSql);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM (${inner})`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM (${inner}) AS a ORDER BY name COLLATE NOCASE ${order} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset }) as Artist[];
    return this.paginate(rows, total, page, limit);
  }

  getArtistDetail(artistId: string): ArtistDetail | undefined {
    const base = this.db
      .prepare(`SELECT * FROM (${this.artistSelect('WHERE artist_key = @id')}) AS a`)
      .get({ id: artistId }) as
      | (Artist & { name: string })
      | undefined;
    if (!base) return undefined;

    const albums: Album[] = this.listAlbumsForArtist(artistId);
    const trackRows = this.db
      .prepare(
        `SELECT * FROM tracks WHERE artist_key = ? ORDER BY album COLLATE NOCASE, COALESCE(disc_no,1), COALESCE(track_no,1)`,
      )
      .all(artistId) as TrackRow[];

    return {
      id: base.id,
      name: base.name,
      trackCount: base.trackCount,
      albumCount: base.albumCount,
      duration: base.duration,
      albums,
      tracks: trackRows.map(rowToTrack),
    };
  }

  private listAlbumsForArtist(artistId: string): Album[] {
    const rows = this.db
      .prepare(`SELECT * FROM (${this.albumSelect('WHERE artist_key = @id')}) AS a`)
      .all({ id: artistId }) as (Omit<Album, 'hasCover'> & { hasCover: number })[];
    return rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        albumArtist: r.albumArtist,
        year: r.year,
        genre: r.genre ?? '',
        trackCount: r.trackCount,
        duration: r.duration,
        dateAdded: r.dateAdded,
        hasCover: r.hasCover === 1,
        coverTrackId: r.coverTrackId,
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  }

  // ── genres ───────────────────────────────────────────────────────
  listGenres(): Genre[] {
    const rows = this.db
      .prepare(
        `SELECT NULLIF(TRIM(genre),'') AS genre, COUNT(*) AS trackCount, COUNT(DISTINCT album_key) AS albumCount
         FROM tracks GROUP BY genre HAVING genre IS NOT NULL ORDER BY genre COLLATE NOCASE`,
      )
      .all() as { genre: string | null; trackCount: number; albumCount: number }[];
    return rows
      .filter((r): r is { genre: string; trackCount: number; albumCount: number } => r.genre !== null)
      .map((r) => ({ name: r.genre, trackCount: r.trackCount, albumCount: r.albumCount }));
  }

  // ── search ───────────────────────────────────────────────────────
  search(q: string, limit = 25): { tracks: Track[]; albums: Album[]; artists: Artist[] } {
    const term = `%${q.toLowerCase()}%`;
    const trackRows = this.db
      .prepare(
        `SELECT * FROM tracks
         WHERE LOWER(title) LIKE ? OR LOWER(artist) LIKE ? OR LOWER(album) LIKE ? OR LOWER(album_artist) LIKE ?
         ORDER BY title COLLATE NOCASE LIMIT ?`,
      )
      .all(term, term, term, term, limit) as TrackRow[];
    const albumRows = this.db
      .prepare(
        `SELECT * FROM (${this.albumSelect(
          'WHERE LOWER(album) LIKE ? OR LOWER(effective_artist) LIKE ?',
        )}) AS a LIMIT ?`,
      )
      .all(term, term, limit) as (Omit<Album, 'hasCover'> & { hasCover: number })[];
    const artistRows = this.db
      .prepare(`SELECT * FROM (${this.artistSelect('WHERE LOWER(effective_artist) LIKE ?')}) AS a LIMIT ?`)
      .all(term, limit) as Artist[];

    return {
      tracks: trackRows.map(rowToTrack),
      albums: albumRows.map((r) => ({
        id: r.id,
        title: r.title,
        albumArtist: r.albumArtist,
        year: r.year,
        genre: r.genre ?? '',
        trackCount: r.trackCount,
        duration: r.duration,
        dateAdded: r.dateAdded,
        hasCover: r.hasCover === 1,
        coverTrackId: r.coverTrackId,
      })),
      artists: artistRows,
    };
  }

  // ── recently added ───────────────────────────────────────────────
  recentlyAdded(limit = 24): Album[] {
    return this.listAlbums({ sort: 'recently_added', order: 'desc', page: 1, limit }).items;
  }

  // ── summary ──────────────────────────────────────────────────────
  summary(libraryPath: string, configured: boolean): LibrarySummary {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS trackCount,
           COUNT(DISTINCT album_key) AS albumCount,
           COUNT(DISTINCT artist_key) AS artistCount,
           COALESCE(SUM(duration),0) AS totalDuration
         FROM tracks`,
      )
      .get() as {
      trackCount: number;
      albumCount: number;
      artistCount: number;
      totalDuration: number;
    };
    const genreCount = this.listGenres().length;
    return {
      trackCount: row.trackCount,
      albumCount: row.albumCount,
      artistCount: row.artistCount,
      genreCount,
      totalDurationSeconds: row.totalDuration,
      configured,
      libraryPath,
    };
  }

  close(): void {
    this.db.close();
  }
}
