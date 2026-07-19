import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './config.ts';
import { log } from './logger.ts';
import { assertRealPathWithin } from './paths.ts';
import type { ScanError, ScanResult, ScanStatus } from './types.ts';
import { VideoDatabase } from './video-db.ts';
import { probeMovie, VIDEO_EXTENSIONS, VIDEO_PROBE_VERSION } from './video-probe.ts';

const VIDEO_SCAN_CONCURRENCY = 2;

export async function collectVideoFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`Cannot read movie directory "${dir}": ${(err as Error).message}`);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          const real = await fsp.realpath(full).catch(() => null);
          if (!real) continue;
          assertRealPathWithin(root, real);
          const stat = await fsp.stat(full).catch(() => null);
          if (!stat) continue;
          if (stat.isDirectory()) await walk(full);
          else if (stat.isFile() && isVideoFile(entry.name)) results.push(full);
        } else if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && isVideoFile(entry.name)) {
          results.push(full);
        }
      } catch (err) {
        log.debug(`Skipping movie path "${full}": ${(err as Error).message}`);
      }
    }
  }

  await walk(root);
  return results;
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filename).slice(1).toLowerCase());
}

export class VideoScanner {
  private status: ScanStatus = {
    scanning: false,
    startedAt: null,
    finishedAt: null,
    total: 0,
    processed: 0,
    lastResult: null,
  };

  constructor(
    private readonly cfg: AppConfig,
    private readonly db: VideoDatabase,
  ) {}

  getStatus(): ScanStatus {
    return { ...this.status };
  }

  isScanning(): boolean {
    return this.status.scanning;
  }

  async scan(): Promise<ScanResult> {
    if (this.status.scanning) {
      return {
        total: this.status.total,
        scanned: this.status.processed,
        added: 0,
        updated: 0,
        skipped: 0,
        removed: 0,
        errors: [],
        durationMs: 0,
      };
    }

    const started = Date.now();
    this.status = {
      scanning: true,
      startedAt: started,
      finishedAt: null,
      total: 0,
      processed: 0,
      lastResult: null,
    };

    const errors: ScanError[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    try {
      const root = this.cfg.movieLibraryPath;
      if (!root) throw new Error('MOVIE_LIBRARY_PATH is not configured.');
      let rootStat: fs.Stats;
      try {
        rootStat = fs.statSync(root);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EACCES' || code === 'EPERM') {
          throw new Error('Permission denied reading the movie library.');
        }
        if (code === 'ENOENT') throw new Error('The configured movie library does not exist.');
        throw err;
      }
      if (!rootStat.isDirectory()) throw new Error('The configured movie library is not a directory.');

      const files = await collectVideoFiles(root);
      this.status.total = files.length;
      const keepPaths = new Set<string>();
      const forceMetadataRefresh =
        this.db.getMeta('movie_probe_version') !== VIDEO_PROBE_VERSION;
      let cursor = 0;

      const worker = async (): Promise<void> => {
        while (cursor < files.length) {
          const absPath = files[cursor++];
          const relPath = path.relative(root, absPath);
          keepPaths.add(absPath);
          try {
            const stat = await fsp.stat(absPath);
            const existing = this.db.getRowByPath(absPath);
            const format = path.extname(absPath).slice(1).toLowerCase();
            if (
              !forceMetadataRefresh &&
              existing &&
              existing.size === stat.size &&
              Math.abs(existing.mtime - stat.mtimeMs) < 500 &&
              existing.format === format
            ) {
              skipped++;
              continue;
            }

            const row = await probeMovie(absPath, relPath, stat);
            row.date_added = existing?.date_added ?? started;
            row.scanned_at = started;
            this.db.upsert(row);
            if (existing) updated++;
            else added++;
          } catch (err) {
            errors.push({
              path: relPath,
              message: (err as Error).message.split(root).join('movie library'),
            });
            log.warn(`Failed to scan movie "${relPath}": ${(err as Error).message}`);
          } finally {
            this.status.processed++;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(VIDEO_SCAN_CONCURRENCY, files.length || 1) }, () => worker()),
      );
      const removed = this.db.pruneMissing(keepPaths);
      this.db.setMeta('movie_library_path', root);
      this.db.setMeta('movie_probe_version', VIDEO_PROBE_VERSION);
      const result: ScanResult = {
        total: files.length,
        scanned: added + updated,
        added,
        updated,
        skipped,
        removed,
        errors,
        durationMs: Date.now() - started,
      };
      this.status.lastResult = result;
      log.info(
        `Movie scan complete: +${added} added, ${updated} updated, ${skipped} skipped, ${removed} removed, ${errors.length} error(s).`,
      );
      return result;
    } catch (err) {
      const result: ScanResult = {
        total: this.status.total,
        scanned: added + updated,
        added,
        updated,
        skipped,
        removed: 0,
        errors: [...errors, { path: '.', message: (err as Error).message }],
        durationMs: Date.now() - started,
      };
      this.status.lastResult = result;
      log.error(`Movie scan failed: ${(err as Error).message}`);
      return result;
    } finally {
      this.status.scanning = false;
      this.status.finishedAt = Date.now();
    }
  }
}
