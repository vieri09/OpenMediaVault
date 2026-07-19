import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { AppConfig } from './config.ts';
import { notFound } from './errors.ts';
import { resolveWithin } from './paths.ts';
import type { SortOrder } from './types.ts';
import { wrap } from './routes.ts';
import { VideoDatabase } from './video-db.ts';
import { ffmpegAvailable } from './video-probe.ts';
import { VideoScanner } from './video-scanner.ts';
import { streamVideo } from './video-stream.ts';
import { movieThumbnail } from './video-thumbnail.ts';
import { VideoTranscoder } from './video-transcode.ts';
import type { MovieSortKey } from './video-types.ts';

export interface VideoServices {
  cfg: AppConfig;
  videoDb: VideoDatabase;
  videoScanner: VideoScanner;
  videoTranscoder: VideoTranscoder;
}

const MOVIE_SORTS = new Set<MovieSortKey>(['title', 'recently_added', 'duration', 'year']);

function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'string' ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function playbackSessionId(value: unknown): string {
  const session = String(value ?? 'legacy');
  return /^[a-zA-Z0-9_-]{1,80}$/.test(session) ? session : 'legacy';
}

function queryParam(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function buildVideoRouter(services: VideoServices): Router {
  const router = Router();
  const root = services.cfg.movieLibraryPath;
  const configured = (): boolean => Boolean(root && fs.existsSync(root));
  const thumbnailRoot = path.join(path.dirname(services.cfg.databasePath), 'movie-thumbnails');

  router.get('/movies/summary', (_req, res) => {
    res.json(services.videoDb.summary(configured(), ffmpegAvailable()));
  });

  router.get('/movies/scan/status', (_req, res) => {
    res.json(services.videoScanner.getStatus());
  });

  router.post('/movies/rescan', (_req, res) => {
    if (!root) {
      res.status(400).json({ error: 'MOVIE_LIBRARY_PATH is not configured.', code: 'MOVIES_NOT_CONFIGURED' });
      return;
    }
    if (services.videoScanner.isScanning()) {
      res.status(409).json({ ...services.videoScanner.getStatus(), message: 'A movie scan is already running.' });
      return;
    }
    void services.videoScanner.scan();
    res.status(202).json({ ...services.videoScanner.getStatus(), message: 'Movie scan started.' });
  });

  router.get('/movies/continue', (req, res) => {
    res.json(services.videoDb.continueWatching(intParam(req.query.limit, 12, 1, 30)));
  });

  router.get('/movies/folders', (_req, res) => {
    res.json(services.videoDb.browseFolder('root'));
  });

  router.get('/movies/folders/:folderId', (req, res) => {
    const page = services.videoDb.browseFolder(String(req.params.folderId));
    if (!page) throw notFound('Movie folder not found.', 'MOVIE_FOLDER_NOT_FOUND');
    res.json(page);
  });

  router.get('/movies', (req, res) => {
    const sort =
      typeof req.query.sort === 'string' && MOVIE_SORTS.has(req.query.sort as MovieSortKey)
        ? (req.query.sort as MovieSortKey)
        : 'title';
    res.json(
      services.videoDb.list({
        sort,
        order: req.query.order === 'desc' ? ('desc' satisfies SortOrder) : ('asc' satisfies SortOrder),
        page: intParam(req.query.page, 1, 1, 100_000),
        limit: intParam(req.query.limit, 36, 1, 100),
        search: queryParam(req.query.search),
      }),
    );
  });

  router.put('/movies/:id/progress', (req, res) => {
    const position = typeof req.body?.position === 'number' ? req.body.position : Number.NaN;
    const duration = typeof req.body?.duration === 'number' ? req.body.duration : Number.NaN;
    if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration < 0) {
      res.status(400).json({ error: 'Invalid playback progress.', code: 'INVALID_PROGRESS' });
      return;
    }
    const saved = services.videoDb.saveProgress(String(req.params.id), position, duration);
    if (!saved) throw notFound('Movie not found.', 'MOVIE_NOT_FOUND');
    res.json(saved);
  });

  router.delete('/movies/:id/progress', (req, res) => {
    services.videoDb.clearProgress(String(req.params.id));
    res.json({ ok: true });
  });

  router.get('/movies/:id/thumbnail', wrap(async (req, res) => {
    if (!root) throw notFound('Movie library is not configured.', 'MOVIES_NOT_CONFIGURED');
    const movie = services.videoDb.getRowById(String(req.params.id));
    if (!movie) throw notFound('Movie not found.', 'MOVIE_NOT_FOUND');
    const source = resolveWithin(root, movie.rel_path);
    try {
      const thumbnail = await movieThumbnail(thumbnailRoot, source, movie);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.sendFile(thumbnail);
    } catch {
      res.status(404).json({ error: 'Could not generate movie thumbnail.', code: 'THUMBNAIL_FAILED' });
    }
  }));

  router.get('/movies/:id/stream', (req, res) => {
    if (!root) throw notFound('Movie library is not configured.', 'MOVIES_NOT_CONFIGURED');
    const movie = services.videoDb.getRowById(String(req.params.id));
    if (!movie) throw notFound('Movie not found.', 'MOVIE_NOT_FOUND');
    streamVideo(root, movie.rel_path, req, res);
  });

  router.get('/movies/:id/subtitles/:streamIndex.vtt', wrap(async (req, res) => {
    if (!root) throw notFound('Movie library is not configured.', 'MOVIES_NOT_CONFIGURED');
    const movie = services.videoDb.getRowById(String(req.params.id));
    if (!movie) throw notFound('Movie not found.', 'MOVIE_NOT_FOUND');
    const source = resolveWithin(root, movie.rel_path);
    const streamIndex = intParam(req.params.streamIndex, -1, -1, 10_000);
    const start = Math.max(
      0,
      Math.min(movie.duration, Number.parseFloat(String(req.query.start ?? '0')) || 0),
    );
    const position = Math.max(
      start,
      Math.min(movie.duration, Number.parseFloat(String(req.query.from ?? start)) || start),
    );
    const subtitle = await services.videoTranscoder.subtitle(
      movie,
      source,
      streamIndex,
      start,
      position,
    );
    if (!subtitle) {
      res.status(404).json({ error: 'Subtitle track not found.', code: 'SUBTITLE_NOT_FOUND' });
      return;
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(subtitle);
  }));

  router.get('/movies/:id/hls/index.m3u8', wrap(async (req, res) => {
    if (!root) throw notFound('Movie library is not configured.', 'MOVIES_NOT_CONFIGURED');
    const movie = services.videoDb.getRowById(String(req.params.id));
    if (!movie) throw notFound('Movie not found.', 'MOVIE_NOT_FOUND');
    const source = resolveWithin(root, movie.rel_path);
    const start = Math.max(0, Math.min(movie.duration, Number.parseFloat(String(req.query.start ?? '0')) || 0));
    const requestedAudio = intParam(req.query.audio, -1, -1, 10_000);
    const sourceVideo =
      req.query.video === 'source' &&
      (movie.video_codec === 'hevc' || movie.video_codec === 'h265');
    const sessionId = playbackSessionId(req.query.session);
    const playlist = await services.videoTranscoder.playlist(
      movie,
      source,
      start,
      requestedAudio,
      sourceVideo,
      sessionId,
    );
    if (!playlist) {
      res.status(502).json({ error: 'Movie transcoding failed.', code: 'TRANSCODE_FAILED' });
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Expires', '0');
    const contents = await fsp.readFile(playlist.file, 'utf8');
    res.end(
      !playlist.includeStartHint || contents.includes('#EXT-X-START:')
        ? contents
        : contents.replace(
            '#EXTM3U\n',
            '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n',
          ),
    );
  }));

  router.get('/movies/:id/hls/:file', wrap(async (req, res) => {
    const filename = String(req.params.file);
    const file = await services.videoTranscoder.file(String(req.params.id), filename);
    if (!file) {
      res.status(404).end();
      return;
    }
    const contentType = filename.endsWith('.ts')
      ? 'video/mp2t'
      : filename.endsWith('.m4s') || filename === 'init.mp4'
        ? 'video/mp4'
      : filename.endsWith('.vtt')
        ? 'text/vtt; charset=utf-8'
        : 'application/vnd.apple.mpegurl';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Cache-Control',
      filename === 'index.m3u8'
        ? 'no-store, no-cache, must-revalidate'
        : 'private, max-age=3600, immutable',
    );
    res.sendFile(file);
  }));

  router.delete('/movies/:id/hls', (req, res) => {
    const stopped = services.videoTranscoder.stop(
      String(req.params.id),
      playbackSessionId(req.query.session),
    );
    res.json({ ok: true, stopped });
  });

  router.get('/movies/:id', (req, res) => {
    const movie = services.videoDb.getMovie(String(req.params.id));
    if (!movie) throw notFound('Movie not found.', 'MOVIE_NOT_FOUND');
    res.json(movie);
  });

  return router;
}
