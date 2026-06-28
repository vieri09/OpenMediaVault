import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { allAudioExtensions, type AppConfig } from './config.ts';
import { LibraryDatabase } from './db.ts';
import { parseTrack } from './metadata.ts';
import { assertRealPathWithin } from './paths.ts';
import { log } from './logger.ts';
import { albumKey, artistKey, trackId } from './keys.ts';
import type { ScanError, ScanResult, ScanStatus } from './types.ts';

const CONCURRENCY = 8;

export interface ProgressEmitter {
  (processed: number, total: number): void;
}

/**
 * Walk `dir` recursively, returning absolute paths of recognized audio files.
 * Symlinks that resolve outside the library root are skipped.
 */
export async function collectAudioFiles(
  root: string,
  extensions: Set<string>,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`Cannot read directory "${dir}": ${(err as Error).message}`);
      return;
    }
    for (const entry of entries) {
      // Skip hidden files/directories (dotfiles, .git, etc.)
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          // Resolve the link target and ensure it stays inside the library.
          const real = await fsp.realpath(full).catch(() => null);
          if (!real) continue;
          assertRealPathWithin(root, real);
          const stat = await fsp.stat(full).catch(() => null);
          if (!stat) continue;
          if (stat.isDirectory()) {
            await walk(full);
          } else if (stat.isFile() && hasAudioExt(entry.name, extensions)) {
            results.push(full);
          }
          continue;
        }
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && hasAudioExt(entry.name, extensions)) {
          results.push(full);
        }
      } catch (err) {
        log.debug(`Skipping "${full}": ${(err as Error).message}`);
      }
    }
  }

  await walk(root);
  return results;
}

export function hasAudioExt(filename: string, extensions: Set<string>): boolean {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return ext !== '' && extensions.has(ext);
}

/** Recursively walk and stat audio files (used by tests without parsing). */
export async function listAudioFiles(root: string, extensions: Set<string>): Promise<string[]> {
  return collectAudioFiles(root, extensions);
}

export class Scanner {
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
    private readonly db: LibraryDatabase,
  ) {}

  getStatus(): ScanStatus {
    return { ...this.status };
  }

  isScanning(): boolean {
    return this.status.scanning;
  }

  /**
   * Scan the library. Resolves with a summary of what changed. If a scan is
   * already running, returns its current status snapshot instead of starting
   * a duplicate. Incremental: files unchanged since last scan (same mtime +
   * size) are skipped without re-parsing.
   */
  async scan(onProgress?: ProgressEmitter): Promise<ScanResult> {
    if (this.status.scanning) {
      // Already running — return a best-effort snapshot.
      const s = this.status;
      const empty: ScanResult = {
        total: s.total,
        scanned: s.processed,
        added: 0,
        updated: 0,
        skipped: 0,
        removed: 0,
        errors: [],
        durationMs: 0,
      };
      return empty;
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
      // Distinguish "missing" from "unreadable": an external drive (e.g.
      // /Volumes/...) can exist yet be blocked by macOS Privacy permissions,
      // which surfaces as EACCES/EPERM rather than ENOENT. existsSync hides
      // that behind a generic false, so stat directly and translate the code.
      try {
        if (!fs.statSync(this.cfg.libraryPath).isDirectory()) {
          throw new Error(`Library path "${this.cfg.libraryPath}" exists but is not a directory.`);
        }
      } catch (statErr) {
        const code = (statErr as NodeJS.ErrnoException).code;
        if (code === 'EACCES' || code === 'EPERM') {
          throw new Error(
            `Permission denied reading "${this.cfg.libraryPath}". On macOS, grant the terminal/app access to this folder: System Settings → Privacy & Security → Files and Folders (or Full Disk Access); for an external drive under /Volumes, also enable Removable Volumes. Then rescan.`,
          );
        }
        if (code === 'ENOENT') {
          throw new Error(`Library path "${this.cfg.libraryPath}" does not exist.`);
        }
        throw statErr;
      }
      const extensions = allAudioExtensions(this.cfg);
      const files = await collectAudioFiles(this.cfg.libraryPath, extensions);
      this.status.total = files.length;
      log.info(`Scan started: ${files.length} audio file(s) found under "${this.cfg.libraryPath}".`);

      // Process in bounded-concurrency batches.
      let cursor = 0;
      const now = started;
      const keepPaths = new Set<string>();

      const worker = async (): Promise<void> => {
        while (cursor < files.length) {
          const index = cursor++;
          const absPath = files[index];
          keepPaths.add(absPath);
          try {
            const stat = await fsp.stat(absPath);
            const relPath = path.relative(this.cfg.libraryPath, absPath);
            const existing = this.db.getByPath(absPath);

            // Incremental: skip if unchanged.
            if (
              existing &&
              Math.abs(existing.mtime - stat.mtimeMs) < 500 &&
              existing.size === stat.size &&
              existing.format === path.extname(absPath).slice(1).toLowerCase()
            ) {
              skipped++;
              this.status.processed++;
              onProgress?.(this.status.processed, this.status.total);
              continue;
            }

            const { row } = await parseTrack(absPath, relPath);
            const wasNew = !existing;
            // Preserve original date_added on update.
            row.date_added = existing?.date_added ?? now;
            row.scanned_at = now;
            this.db.upsertTrack(row);
            if (wasNew) added++;
            else updated++;
          } catch (err) {
            errors.push({ path: absPath, message: (err as Error).message });
            log.warn(`Failed to scan "${absPath}": ${(err as Error).message}`);
          } finally {
            this.status.processed++;
            onProgress?.(this.status.processed, this.status.total);
          }
        }
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, files.length || 1) }, () => worker());
      await Promise.all(workers);

      const removed = this.db.pruneMissing(keepPaths);

      // Remember which library root this cache was built from. On the next boot
      // the server compares this against the configured path and auto-rescans
      // if the user repointed MUSIC_LIBRARY_PATH — instead of serving a stale
      // cache built from a different folder.
      this.db.setMeta('library_path', this.cfg.libraryPath);

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
        `Scan complete: +${added} added, ${updated} updated, ${skipped} skipped, ${removed} removed, ${errors.length} error(s) in ${result.durationMs}ms.`,
      );
      return result;
    } catch (err) {
      const result: ScanResult = {
        total: this.status.total,
        scanned: 0,
        added,
        updated,
        skipped,
        removed: 0,
        errors: [...errors, { path: this.cfg.libraryPath, message: (err as Error).message }],
        durationMs: Date.now() - started,
      };
      this.status.lastResult = result;
      log.error(`Scan failed: ${(err as Error).message}`);
      return result;
    } finally {
      this.status.scanning = false;
      this.status.finishedAt = Date.now();
    }
  }
}

// Re-export key helpers some modules import transitively.
export { trackId, albumKey, artistKey };
