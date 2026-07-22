import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import type { AppConfig } from './config.ts';
import { log } from './logger.ts';
import { assertRealPathWithin } from './paths.ts';
import type { ScanError, ScanResult, ScanStatus } from './types.ts';
import { BookDatabase } from './book-db.ts';
import type { BookRow } from './book-db.ts';
import { trackId } from './keys.ts';

const BOOK_EXTENSIONS = new Set(['cbz']);
const BOOK_SCAN_CONCURRENCY = 2;

/** Image extensions recognized inside CBZ archives. */
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp)$/i;

async function collectBookFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`Cannot read book directory "${dir}": ${(err as Error).message}`);
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
          else if (stat.isFile() && isBookFile(entry.name)) results.push(full);
        } else if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && isBookFile(entry.name)) {
          results.push(full);
        }
      } catch (err) {
        log.debug(`Skipping book path "${full}": ${(err as Error).message}`);
      }
    }
  }

  await walk(root);
  return results;
}

function isBookFile(filename: string): boolean {
  return BOOK_EXTENSIONS.has(path.extname(filename).slice(1).toLowerCase());
}

/**
 * Derive a human-readable title from the file name.
 * "Amazing Comic Vol 1.cbz" → "Amazing Comic Vol 1"
 */
function titleFromFilename(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[_]/g, ' ').trim() || 'Untitled';
}

/**
 * Determine the folder (parent directory name) for a relative path.
 * "Comics/Series/Chapter.cbz" → "Comics/Series"
 */
function folderFromRelPath(relPath: string): string {
  const dir = path.dirname(relPath);
  return dir === '.' ? '' : dir;
}

/**
 * Extract book metadata from a CBZ file.
 * Returns page count and saves cover thumbnail to disk.
 */
async function probeBook(
  absPath: string,
  relPath: string,
  stat: fs.Stats,
  thumbnailRoot: string,
): Promise<BookRow> {
  const buffer = await fsp.readFile(absPath);
  const zip = await JSZip.loadAsync(buffer);
  const imageFiles = Object.keys(zip.files)
    .filter((name) => IMAGE_EXTENSIONS.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const pageCount = imageFiles.length;

  // Extract first image as cover thumbnail
  const title = titleFromFilename(absPath);
  const bookId = trackId(`book:${relPath}`);
  const thumbnailPath = path.join(thumbnailRoot, `${bookId}.jpg`);

  if (imageFiles.length > 0) {
    try {
      const firstImage = zip.files[imageFiles[0]];
      if (firstImage && !firstImage.dir) {
        const imageData = await firstImage.async('nodebuffer');
        fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
        await fsp.writeFile(thumbnailPath, imageData);
      }
    } catch (err) {
      log.warn(`Failed to extract cover for "${relPath}": ${(err as Error).message}`);
    }
  }

  return {
    id: bookId,
    file_path: absPath,
    rel_path: relPath,
    title,
    folder: folderFromRelPath(relPath),
    format: 'cbz',
    page_count: pageCount,
    size: stat.size,
    mtime: stat.mtimeMs,
    date_added: 0,
    scanned_at: 0,
  };
}

export class BookScanner {
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
    private readonly db: BookDatabase,
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
      const root = this.cfg.bookLibraryPath;
      if (!root) throw new Error('BOOK_LIBRARY_PATH is not configured.');
      let rootStat: fs.Stats;
      try {
        rootStat = fs.statSync(root);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EACCES' || code === 'EPERM') {
          throw new Error('Permission denied reading the book library.');
        }
        if (code === 'ENOENT') throw new Error('The configured book library does not exist.');
        throw err;
      }
      if (!rootStat.isDirectory()) throw new Error('The configured book library is not a directory.');

      const thumbnailRoot = path.join(path.dirname(this.cfg.databasePath), 'book-thumbnails');
      fs.mkdirSync(thumbnailRoot, { recursive: true });

      const files = await collectBookFiles(root);
      this.status.total = files.length;
      const keepPaths = new Set<string>();
      let cursor = 0;

      const worker = async (): Promise<void> => {
        while (cursor < files.length) {
          const absPath = files[cursor++];
          const relPath = path.relative(root, absPath);
          keepPaths.add(absPath);
          try {
            const stat = await fsp.stat(absPath);
            const existing = this.db.getRowByPath(absPath);
            if (
              existing &&
              existing.size === stat.size &&
              Math.abs(existing.mtime - stat.mtimeMs) < 500
            ) {
              skipped++;
              continue;
            }

            const row = await probeBook(absPath, relPath, stat, thumbnailRoot);
            row.date_added = existing?.date_added ?? started;
            row.scanned_at = started;
            this.db.upsert(row);
            if (existing) updated++;
            else added++;
          } catch (err) {
            errors.push({
              path: relPath,
              message: (err as Error).message.split(root).join('book library'),
            });
            log.warn(`Failed to scan book "${relPath}": ${(err as Error).message}`);
          } finally {
            this.status.processed++;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(BOOK_SCAN_CONCURRENCY, files.length || 1) }, () => worker()),
      );
      const removed = this.db.pruneMissing(keepPaths);
      this.db.invalidateFolderCache();
      this.db.setMeta('book_library_path', root);
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
        `Book scan complete: +${added} added, ${updated} updated, ${skipped} skipped, ${removed} removed, ${errors.length} error(s).`,
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
      log.error(`Book scan failed: ${(err as Error).message}`);
      return result;
    } finally {
      this.status.scanning = false;
      this.status.finishedAt = Date.now();
    }
  }
}
