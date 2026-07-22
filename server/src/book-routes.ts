import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppConfig } from './config.ts';
import { notFound } from './errors.ts';
import { resolveWithin } from './paths.ts';
import { wrap } from './routes.ts';
import { BookDatabase } from './book-db.ts';
import { BookScanner } from './book-scanner.ts';
import type { BookSortKey } from './book-types.ts';
import type { SortOrder } from './types.ts';

export interface BookServices {
  cfg: AppConfig;
  bookDb: BookDatabase;
  bookScanner: BookScanner;
}

const BOOK_SORTS = new Set<BookSortKey>(['title', 'recently_added', 'page_count']);

function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'string' ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function queryParam(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function buildBookRouter(services: BookServices): Router {
  const router = Router();
  const root = services.cfg.bookLibraryPath;
  const configured = (): boolean => Boolean(root && fs.existsSync(root));

  router.get('/books/summary', (_req, res) => {
    res.json(services.bookDb.summary(configured()));
  });

  router.get('/books/scan/status', (_req, res) => {
    res.json(services.bookScanner.getStatus());
  });

  router.post('/books/rescan', (_req, res) => {
    if (!root) {
      res.status(400).json({ error: 'BOOK_LIBRARY_PATH is not configured.', code: 'BOOKS_NOT_CONFIGURED' });
      return;
    }
    if (services.bookScanner.isScanning()) {
      res.status(409).json({ ...services.bookScanner.getStatus(), message: 'A book scan is already running.' });
      return;
    }
    void services.bookScanner.scan();
    res.status(202).json({ ...services.bookScanner.getStatus(), message: 'Book scan started.' });
  });

  router.get('/books', (req, res) => {
    const sort =
      typeof req.query.sort === 'string' && BOOK_SORTS.has(req.query.sort as BookSortKey)
        ? (req.query.sort as BookSortKey)
        : 'title';
    res.json(
      services.bookDb.list({
        sort,
        order: req.query.order === 'desc' ? ('desc' satisfies SortOrder) : ('asc' satisfies SortOrder),
        page: intParam(req.query.page, 1, 1, 100_000),
        limit: intParam(req.query.limit, 36, 1, 100),
        search: queryParam(req.query.search),
      }),
    );
  });

  // Folder browsing — must be registered before /:id to avoid route conflicts.
  router.get('/books/folders', (_req, res) => {
    const page = services.bookDb.browseFolder('root');
    if (!page) throw notFound('Book library root not found.', 'BOOK_FOLDER_NOT_FOUND');
    res.json(page);
  });

  router.get('/books/folders/:folderId', (req, res) => {
    const page = services.bookDb.browseFolder(String(req.params.folderId));
    if (!page) throw notFound('Book folder not found.', 'BOOK_FOLDER_NOT_FOUND');
    res.json(page);
  });

  router.get('/books/continue', (req, res) => {
    res.json(services.bookDb.continueReading(intParam(req.query.limit, 12, 1, 30)));
  });

  router.put('/books/:id/progress', (req, res) => {
    const page = typeof req.body?.page === 'number' ? req.body.page : Number.NaN;
    if (!Number.isFinite(page) || page < 1) {
      res.status(400).json({ error: 'Invalid page number.', code: 'INVALID_PROGRESS' });
      return;
    }
    const saved = services.bookDb.saveProgress(String(req.params.id), Math.round(page));
    if (!saved) throw notFound('Book not found.', 'BOOK_NOT_FOUND');
    res.json(saved);
  });

  router.delete('/books/:id/progress', (req, res) => {
    services.bookDb.clearProgress(String(req.params.id));
    res.json({ ok: true });
  });

  router.get('/books/:id', (req, res) => {
    const book = services.bookDb.getBook(String(req.params.id));
    if (!book) throw notFound('Book not found.', 'BOOK_NOT_FOUND');
    res.json(book);
  });

  // Serve raw CBZ file for client-side extraction.
  router.get('/books/:id/file', (req, res) => {
    if (!root) throw notFound('Book library is not configured.', 'BOOKS_NOT_CONFIGURED');
    const row = services.bookDb.getRowById(String(req.params.id));
    if (!row) throw notFound('Book not found.', 'BOOK_NOT_FOUND');
    const filePath = resolveWithin(root, row.rel_path);
    if (!fs.existsSync(filePath)) throw notFound('Book file not found on disk.', 'BOOK_FILE_MISSING');
    res.setHeader('Content-Type', 'application/vnd.comicbook+zip');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(filePath);
  });

  // Serve cover thumbnail.
  router.get('/books/:id/thumbnail', (req, res) => {
    if (!root) throw notFound('Book library is not configured.', 'BOOKS_NOT_CONFIGURED');
    const row = services.bookDb.getRowById(String(req.params.id));
    if (!row) throw notFound('Book not found.', 'BOOK_NOT_FOUND');

    const thumbnailRoot = path.join(path.dirname(services.cfg.databasePath), 'book-thumbnails');
    const thumbnailPath = path.join(thumbnailRoot, `${row.id}.jpg`);
    if (!fs.existsSync(thumbnailPath)) {
      res.status(404).json({ error: 'No thumbnail available.', code: 'NO_THUMBNAIL' });
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.sendFile(thumbnailPath);
  });

  // Resolve the page-cache directory for a given book id.
  function pageCacheRoot(): string {
    return path.join(path.dirname(services.cfg.databasePath), 'book-pages');
  }

  function pageCacheDir(bookId: string): string {
    return path.join(pageCacheRoot(), bookId);
  }

  /** Look up a cached page file. Returns the path if it exists, null otherwise. */
  function findCachedPage(bookId: string, pageNum: number): string | null {
    const dir = pageCacheDir(bookId);
    for (const ext of ['.jpg', '.jpeg', '.png', '.gif', '.webp']) {
      const candidate = path.join(dir, `${pageNum}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** Guess MIME type from file extension. */
  function mimeFromExt(ext: string): string {
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    };
    return map[ext.toLowerCase()] || 'image/jpeg';
  }

  /** Serve a cached page image with long-lived immutable headers. */
  function sendCachedPage(res: import('express').Response, filePath: string): void {
    res.setHeader('Content-Type', mimeFromExt(path.extname(filePath)));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(filePath);
  }

  // Serve a single page image, extracted from the CBZ and cached to disk.
  // On first access the CBZ is read and a batch of nearby pages are pre-cached
  // so subsequent pages (and re-reads) are served as static files.
  router.get('/books/:id/page/:pageNum', wrap(async (req, res) => {
    if (!root) throw notFound('Book library is not configured.', 'BOOKS_NOT_CONFIGURED');
    const row = services.bookDb.getRowById(String(req.params.id));
    if (!row) throw notFound('Book not found.', 'BOOK_NOT_FOUND');

    const pageNum = intParam(req.params.pageNum, 1, 1, 100_000);
    if (pageNum < 1 || pageNum > row.page_count) {
      throw notFound('Page number out of range.', 'PAGE_NOT_FOUND');
    }

    // Check disk cache first — near-zero cost for previously extracted pages.
    const cached = findCachedPage(row.id, pageNum);
    if (cached) return sendCachedPage(res, cached);

    // Cache miss — read the CBZ once and pre-cache a batch of pages.
    const filePath = resolveWithin(root, row.rel_path);
    if (!fs.existsSync(filePath)) throw notFound('Book file not found on disk.', 'BOOK_FILE_MISSING');

    const JSZip = (await import('jszip')).default;
    const buffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)$/i;
    const imageFiles = Object.keys(zip.files)
      .filter((name) => IMAGE_EXT.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // Pre-cache a batch of pages around the requested one.
    // This amortizes the expensive CBZ read+parse across multiple pages.
    const BATCH = 10;
    const batchStart = Math.max(0, pageNum - 1); // 0-indexed
    const batchEnd = Math.min(imageFiles.length, batchStart + BATCH);
    const cacheDir = pageCacheDir(row.id);
    fs.mkdirSync(cacheDir, { recursive: true });

    const batchData: Buffer[] = [];
    const batchExts: string[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const entry = zip.files[imageFiles[i]];
      if (!entry || entry.dir) continue;
      const data = await entry.async('nodebuffer');
      const ext = path.extname(imageFiles[i]).toLowerCase();
      await fs.promises.writeFile(path.join(cacheDir, `${i + 1}${ext}`), data);
      batchData[i - batchStart] = data;
      batchExts[i - batchStart] = ext;
    }

    // Serve the requested page from the batch we just extracted.
    const idx = pageNum - 1 - batchStart;
    const data = batchData[idx];
    const ext = batchExts[idx];
    if (!data) throw notFound('Page data not found.', 'PAGE_NOT_FOUND');

    res.setHeader('Content-Type', mimeFromExt(ext));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(data);
  }));

  return router;
}
