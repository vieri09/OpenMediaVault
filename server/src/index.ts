import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { LibraryDatabase } from './db.ts';
import { Scanner } from './scanner.ts';
import { buildRouter } from './routes.ts';
import { HttpError } from './errors.ts';
import { log, setLogLevel } from './logger.ts';

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
}

export function createApp(deps: AppDeps = {}) {
  const cfg = deps.cfg ?? loadConfig();
  setLogLevel(cfg.logLevel);
  const db = deps.db ?? new LibraryDatabase(cfg.databasePath);
  const scanner = deps.scanner ?? new Scanner(cfg, db);

  const app = express();
  app.disable('x-powered-by');
  app.set('logger', log);

  // Minimal request logger (skip noisy stream/cover bytes logs).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/stream') || req.path.startsWith('/api/cover')) return;
      log.debug(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.use('/api', buildRouter({ cfg, db, scanner }));

  // Production: serve the built client SPA if it exists.
  const clientDist = path.resolve(PROJECT_ROOT, 'client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      // Avoid intercepting API routes (already mounted) — only SPA-fallback for HTML.
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // 404 for unmatched API routes.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  });

  // Centralized error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    log.error(`Unhandled error: ${(err as Error)?.message ?? err}`);
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL' });
  });

  return { app, cfg, db, scanner };
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

  const { app, db, scanner } = createApp({ cfg });

  const server = app.listen(cfg.port, () => {
    log.info(`OpenMedia server listening on http://localhost:${cfg.port}`);
    log.info(`Music library: ${cfg.libraryPath}`);
    log.info(`Database:      ${cfg.databasePath}`);
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
