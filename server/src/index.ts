import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { LibraryDatabase } from './db.ts';
import { Scanner } from './scanner.ts';
import { buildRouter } from './routes.ts';
import { buildVideoRouter } from './video-routes.ts';
import { HttpError } from './errors.ts';
import { log, setLogLevel } from './logger.ts';
import { VideoDatabase } from './video-db.ts';
import { VIDEO_PROBE_VERSION } from './video-probe.ts';
import { VideoScanner } from './video-scanner.ts';
import { VideoTranscoder } from './video-transcode.ts';

/**
 * Project root, resolved from this source file so it is independent of the
 * process working directory (npm runs workspace scripts with cwd = the
 * workspace dir, not the repo root).
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface AppDeps {
  cfg?: ReturnType<typeof loadConfig>;
  db?: LibraryDatabase;
  scanner?: Scanner;
  videoDb?: VideoDatabase;
  videoScanner?: VideoScanner;
  videoTranscoder?: VideoTranscoder;
}

export function createApp(deps: AppDeps = {}) {
  const cfg = deps.cfg ?? loadConfig();
  setLogLevel(cfg.logLevel);
  const db = deps.db ?? new LibraryDatabase(cfg.databasePath);
  const scanner = deps.scanner ?? new Scanner(cfg, db);
  const videoDb = deps.videoDb ?? new VideoDatabase(cfg.databasePath);
  const videoScanner = deps.videoScanner ?? new VideoScanner(cfg, videoDb);
  const videoTranscoder = deps.videoTranscoder ?? new VideoTranscoder(cfg.databasePath);

  const app = express();
  app.disable('x-powered-by');
  app.set('logger', log);

  if (['127.0.0.1', 'localhost', '::1'].includes(cfg.host)) {
    app.use((req, res, next) => {
      if (!['127.0.0.1', 'localhost', '::1'].includes(req.hostname)) {
        res.status(421).json({ error: 'Host is not allowed.', code: 'INVALID_HOST' });
        return;
      }
      next();
    });
  }

  // The UI is same-origin and needs no third-party scripts, frames, sensors, or
  // referrer data. Keep inline styles enabled because components use them for
  // dynamic slider progress and layout values.
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));

  // Minimal request logger (skip noisy stream/cover bytes logs).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/stream') || req.path.startsWith('/api/cover')) return;
      log.debug(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.use('/api', (req, res, next) => {
    // Cross-site forms can issue simple POST requests even without CORS access
    // to the response. Reject them before they can trigger filesystem work.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(403).json({ error: 'Cross-site requests are not allowed.', code: 'CROSS_SITE_REQUEST' });
      return;
    }
    next();
  });
  app.use('/api', buildRouter({ cfg, db, scanner }));
  app.use('/api', buildVideoRouter({ cfg, videoDb, videoScanner, videoTranscoder }));

  // Production: serve the built client SPA if it exists.
  const clientDist = path.resolve(PROJECT_ROOT, 'client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, {
      dotfiles: 'deny',
      index: false,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest'].includes(path.basename(filePath))) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get('*', (req, res, next) => {
      // Avoid intercepting API routes (already mounted) — only SPA-fallback for HTML.
      if (req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // 404 for unmatched API routes.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  });

  // Centralized error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      err instanceof SyntaxError &&
      'status' in err &&
      (err as SyntaxError & { status?: number }).status === 400
    ) {
      res.status(400).json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    log.error(`Unhandled error: ${(err as Error)?.message ?? err}`);
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL' });
  });

  return { app, cfg, db, scanner, videoDb, videoScanner, videoTranscoder };
}

async function bootstrap(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
     
    console.error(`\nConfiguration error: ${(err as Error).message}\n`);
    process.exit(1);
  }
  setLogLevel(cfg.logLevel);

  const { app, db, scanner, videoDb, videoScanner, videoTranscoder } = createApp({ cfg });

  const server = app.listen(cfg.port, cfg.host, () => {
    log.info(`OpenMedia server listening on http://${cfg.host}:${cfg.port}`);
    log.info(`Music library: ${cfg.libraryPath}`);
    log.info(`Database:      ${cfg.databasePath}`);
    if (cfg.movieLibraryPath) log.info(`Movie library: ${cfg.movieLibraryPath}`);
    if (!fs.existsSync(cfg.libraryPath)) {
      log.warn(
        `Library folder does not exist yet. Set MUSIC_LIBRARY_PATH in .env to your music folder, then trigger a rescan.`,
      );
    } else {
      // Auto-scan when (a) the cache is empty, or (b) the configured library
      // root differs from the one this cache was built from — e.g. the user
      // repointed MUSIC_LIBRARY_PATH to a new folder (a different drive, etc.).
      // Case (b) prunes the stale tracks from the old location and indexes the
      // new one, instead of silently serving an out-of-date library.
      const lastLibrary = db.getMeta('library_path');
      if (db.count() === 0) {
        log.info(`Library is empty. An initial scan will start automatically…`);
        scanner.scan().catch((e) => log.error(`Initial scan failed: ${(e as Error).message}`));
      } else if (lastLibrary !== cfg.libraryPath) {
        log.info(
          `Music folder changed since last scan${lastLibrary ? ` ("${lastLibrary}" → "${cfg.libraryPath}")` : ''}; rescanning…`,
        );
        scanner.scan().catch((e) => log.error(`Rescan after path change failed: ${(e as Error).message}`));
      }
    }
    if (cfg.movieLibraryPath && fs.existsSync(cfg.movieLibraryPath)) {
      const lastMovieLibrary = videoDb.getMeta('movie_library_path');
      const movieMetadataOutdated =
        videoDb.getMeta('movie_probe_version') !== VIDEO_PROBE_VERSION;
      if (
        videoDb.count() === 0 ||
        lastMovieLibrary !== cfg.movieLibraryPath ||
        movieMetadataOutdated
      ) {
        log.info('Movie library needs indexing; starting a background movie scan…');
        void videoScanner.scan();
      }
    }
  });

  // Surface a bind failure — almost always a port clash with another dev
  // server on this machine — as a clear, actionable message instead of an
  // unhandled-exception crash loop.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(
        `Port ${cfg.port} is already in use by another app. Stop that app, or set a different APP_PORT in .env (e.g. APP_PORT=3001), then restart.`,
      );
    } else {
      log.error(`Failed to start server on port ${cfg.port}: ${err.message}`);
    }
    process.exit(1);
  });

  const shutdown = (signal: string): void => {
    log.info(`${signal} received, shutting down…`);
    try {
      db.close();
      videoDb.close();
      videoTranscoder.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only bootstrap when run directly (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  bootstrap().catch((err) => {
    log.error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
