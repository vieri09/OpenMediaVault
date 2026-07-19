import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import { LibraryDatabase } from './db.ts';
import { Scanner } from './scanner.ts';
import { readCover } from './metadata.ts';
import path from 'node:path';
import { streamTrackAudio } from './stream.ts';
import { notFound } from './errors.ts';
import { resolveWithin } from './paths.ts';
import type { AppConfig } from './config.ts';
import type { AlbumSortKey, SortOrder, TrackSortKey } from './types.ts';

export interface Services {
  cfg: AppConfig;
  db: LibraryDatabase;
  scanner: Scanner;
}

function asInt(v: unknown, def: number, min = 1, max = 500): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : def;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function asOrder(v: unknown): SortOrder {
  return v === 'desc' ? 'desc' : 'asc';
}

function asQuery(v: unknown, maxLength = 200): string | undefined {
  if (typeof v !== 'string') return undefined;
  const value = v.trim();
  return value ? value.slice(0, maxLength) : undefined;
}

const ALBUM_SORTS = new Set<AlbumSortKey>(['title', 'artist', 'year', 'recently_added']);
const TRACK_SORTS = new Set<TrackSortKey>(['title', 'artist', 'album', 'duration', 'date_added']);

export function buildRouter(svc: Services): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Library summary + configuration status.
  router.get('/library/summary', (_req, res) => {
    const configured = svc.cfg.libraryPath.length > 0 && fs.existsSync(svc.cfg.libraryPath);
    res.json(svc.db.summary(configured));
  });

  // Scan status (no body needed for a GET).
  router.get('/scan/status', (_req, res) => {
    res.json(svc.scanner.getStatus());
  });

  // Trigger a rescan. Runs asynchronously; responds with the scan status.
  router.post('/rescan', (_req, res) => {
    if (svc.scanner.isScanning()) {
      res.status(409).json({ ...svc.scanner.getStatus(), message: 'A scan is already running.' });
      return;
    }
    // Fire and forget — caller polls /scan/status.
    svc.scanner.scan().catch(() => {
      /* errors are recorded in scan status */
    });
    res.status(202).json({ ...svc.scanner.getStatus(), message: 'Rescan started.' });
  });

  // Tracks
  router.get('/tracks', (req, res) => {
    const sort = typeof req.query.sort === 'string' && TRACK_SORTS.has(req.query.sort as TrackSortKey)
      ? (req.query.sort as TrackSortKey)
      : 'title';
    res.json(
      svc.db.listTracks({
        sort,
        order: asOrder(req.query.order),
        page: asInt(req.query.page, 1, 1, 100000),
        limit: asInt(req.query.limit, 100, 1, 500),
        search: asQuery(req.query.search),
        genre: asQuery(req.query.genre, 100),
      }),
    );
  });

  // Albums
  router.get('/albums', (req, res) => {
    const sort = typeof req.query.sort === 'string' && ALBUM_SORTS.has(req.query.sort as AlbumSortKey)
      ? (req.query.sort as AlbumSortKey)
      : 'title';
    res.json(
      svc.db.listAlbums({
        sort,
        order: asOrder(req.query.order),
        page: asInt(req.query.page, 1, 1, 100000),
        limit: asInt(req.query.limit, 50, 1, 500),
        search: asQuery(req.query.search),
      }),
    );
  });

  router.get('/albums/recent', (req, res) => {
    res.json(svc.db.recentlyAdded(asInt(req.query.limit, 24, 1, 200)));
  });

  router.get('/albums/:id', (req, res) => {
    const detail = svc.db.getAlbumDetail(String(req.params.id));
    if (!detail) throw notFound('Album not found.', 'ALBUM_NOT_FOUND');
    res.json(detail);
  });

  // Artists
  router.get('/artists', (req, res) => {
    res.json(
      svc.db.listArtists({
        order: asOrder(req.query.order),
        page: asInt(req.query.page, 1, 1, 100000),
        limit: asInt(req.query.limit, 100, 1, 500),
        search: asQuery(req.query.search),
      }),
    );
  });

  router.get('/artists/:id', (req, res) => {
    const detail = svc.db.getArtistDetail(String(req.params.id));
    if (!detail) throw notFound('Artist not found.', 'ARTIST_NOT_FOUND');
    res.json(detail);
  });

  // Genres
  router.get('/genres', (_req, res) => {
    res.json(svc.db.listGenres());
  });

  // Search
  router.get('/search', (req, res) => {
    const q = asQuery(req.query.q) ?? '';
    if (!q) {
      res.json({ tracks: [], albums: [], artists: [] });
      return;
    }
    res.json(svc.db.search(q, asInt(req.query.limit, 25, 1, 100)));
  });

  // Stream audio for a track id.
  router.get(
    '/stream/:id',
    wrap(async (req, res) => {
      const track = svc.db.getById(String(req.params.id));
      if (!track) throw notFound('Track not found.', 'TRACK_NOT_FOUND');
      const cacheRoot = path.join(path.dirname(svc.cfg.databasePath), 'transcodes');
      await streamTrackAudio(svc.cfg.libraryPath, cacheRoot, track, req, res);
    }),
  );

  // Cover art for a track id.
  router.get(
    '/cover/:id',
    wrap(async (req, res) => {
      const track = svc.db.getById(String(req.params.id));
      if (!track) throw notFound('Track not found.', 'TRACK_NOT_FOUND');
      // Validate the stored relative path is still within the library.
      const abs = resolveWithin(svc.cfg.libraryPath, track.rel_path);
      try {
        const cover = await readCover(abs);
        if (!cover) {
          res.status(404).json({ error: 'No embedded cover art.', code: 'NO_COVER' });
          return;
        }
        res.setHeader('Content-Type', cover.mime || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
        res.status(200).send(cover.data);
      } catch {
        throw notFound('Could not read cover art (file missing or unsupported).', 'COVER_READ_ERROR');
      }
    }),
  );

  return router;
}

/** Async handler wrapper so thrown errors reach the error middleware. */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
