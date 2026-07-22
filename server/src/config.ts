import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

/**
 * Project root, resolved from this source file's location.
 *
 * Why not process.cwd()? npm runs workspace scripts with cwd = the workspace
 * directory (server/), not the repo root. The `.env` and the default relative
 * paths (./music, ./data/library.db) live at the repo root, so deriving the
 * root from the file location — instead of cwd — keeps config identical no
 * matter how the server is launched (`npm run dev`, `npm start`, `tsx watch`,
 * direct `node`, or the test runner). This mirrors the PROJECT_ROOT logic in
 * index.ts.
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load `.env` from the project root. dotenv.config is a no-op (returns an
// error object, never throws) when the file is missing, so environments
// without a `.env` (CI, tests) still work — they just must set vars out of band.
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env') });

/** Audio file extensions we recognize and try to scan/play. */
export const AUDIO_EXTENSIONS = new Set<string>([
  'mp3',
  'flac',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'oga',
  'weba',
  'wma', // parsed on a best-effort basis
]);

export interface AppConfig {
  /** Absolute path to the music library root. */
  libraryPath: string;
  /** Optional absolute path to the local movie library. */
  movieLibraryPath: string | null;
  /** Optional absolute path to the local book library. */
  bookLibraryPath: string | null;
  /** Port the HTTP server listens on. */
  port: number;
  /** Interface to bind. Loopback by default so the unauthenticated library stays local. */
  host: string;
  /** Absolute path to the SQLite cache database. */
  databasePath: string;
  /** Extra audio extensions supplied via env. */
  extraExtensions: Set<string>;
  /** Log verbosity. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function parseExtraExtensions(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
  );
}

/** All recognized audio extensions (built-in + user-supplied). */
export function allAudioExtensions(cfg: AppConfig): Set<string> {
  return new Set([...AUDIO_EXTENSIONS, ...cfg.extraExtensions]);
}

/**
 * Resolve a possibly-relative path against the project root. Absolute paths are
 * returned unchanged. This keeps MUSIC_LIBRARY_PATH and DATABASE_PATH
 * independent of the process working directory.
 */
function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

/**
 * Resolve and validate configuration from environment variables.
 * Throws on unrecoverable misconfiguration.
 */
export function loadConfig(): AppConfig {
  const rawLibrary = process.env.MUSIC_LIBRARY_PATH ?? './music';
  const libraryPath = resolveFromRoot(rawLibrary);
  const rawMovieLibrary = process.env.MOVIE_LIBRARY_PATH?.trim();
  const movieLibraryPath = rawMovieLibrary ? resolveFromRoot(rawMovieLibrary) : null;
  const rawBookLibrary = process.env.BOOK_LIBRARY_PATH?.trim();
  const bookLibraryPath = rawBookLibrary ? resolveFromRoot(rawBookLibrary) : null;

  const port = Number.parseInt(process.env.APP_PORT ?? '3000', 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid APP_PORT "${process.env.APP_PORT}". Expected a number in 1..65535.`);
  }

  const host = (process.env.APP_HOST ?? '127.0.0.1').trim();
  if (!host || host.length > 253 || /[\s/]/.test(host)) {
    throw new Error(`Invalid APP_HOST "${process.env.APP_HOST}".`);
  }

  const rawDb = process.env.DATABASE_PATH ?? './data/library.db';
  const databasePath = resolveFromRoot(rawDb);

  const logLevel = (process.env.LOG_LEVEL ?? 'info') as AppConfig['logLevel'];
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL "${process.env.LOG_LEVEL}".`);
  }

  // We do NOT fail hard if the library folder is missing — the app should still
  // boot and report a clear "library not configured" state. The scanner will
  // surface a friendly error instead.
  if (fs.existsSync(libraryPath) && !fs.statSync(libraryPath).isDirectory()) {
    throw new Error(`MUSIC_LIBRARY_PATH "${libraryPath}" exists but is not a directory.`);
  }
  if (
    movieLibraryPath &&
    fs.existsSync(movieLibraryPath) &&
    !fs.statSync(movieLibraryPath).isDirectory()
  ) {
    throw new Error(`MOVIE_LIBRARY_PATH "${movieLibraryPath}" exists but is not a directory.`);
  }
  if (
    bookLibraryPath &&
    fs.existsSync(bookLibraryPath) &&
    !fs.statSync(bookLibraryPath).isDirectory()
  ) {
    throw new Error(`BOOK_LIBRARY_PATH "${bookLibraryPath}" exists but is not a directory.`);
  }

  return {
    libraryPath,
    movieLibraryPath,
    bookLibraryPath,
    port,
    host,
    databasePath,
    extraExtensions: parseExtraExtensions(process.env.EXTRA_AUDIO_EXTENSIONS),
    logLevel,
  };
}
