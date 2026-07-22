import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { trackId } from './keys.ts';
import type { Book, BookFolder, BookFolderCrumb, BookFolderPage, BookProgress, BookSortKey, BookSummary } from './book-types.ts';
import type { PageResult, SortOrder } from './types.ts';

export interface BookRow {
  id: string;
  file_path: string;
  rel_path: string;
  title: string;
  folder: string;
  format: string;
  page_count: number;
  size: number;
  mtime: number;
  date_added: number;
  scanned_at: number;
}

type PublicBookRow = BookRow & {
  resume_page: number | null;
  progress_updated_at: number | null;
};

const BOOK_SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  rel_path TEXT NOT NULL,
  title TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'cbz',
  page_count INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  date_added INTEGER NOT NULL DEFAULT 0,
  scanned_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_date_added ON books(date_added DESC);
CREATE INDEX IF NOT EXISTS idx_books_folder ON books(folder);

CREATE TABLE IF NOT EXISTS book_progress (
  book_id TEXT PRIMARY KEY,
  page INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_book_progress_updated ON book_progress(updated_at DESC);
`;

const BOOK_SELECT = `
  SELECT
    b.*,
    p.page AS resume_page,
    p.updated_at AS progress_updated_at
  FROM books b
  LEFT JOIN book_progress p ON p.book_id = b.id
`;

const BOOK_SORT: Record<BookSortKey, string> = {
  title: 'title COLLATE NOCASE',
  recently_added: 'date_added',
  page_count: 'page_count',
};

const ROOT_FOLDER_ID = 'root';

function normalizeDirectory(value: string): string {
  const normalized = value.split(path.sep).join('/');
  return normalized === '.' ? '' : normalized.replace(/^\/+|\/+$/g, '');
}

function folderId(directory: string): string {
  return directory ? trackId(`book-folder:${directory}`) : ROOT_FOLDER_ID;
}

function rowToBook(row: PublicBookRow): Book {
  return {
    id: row.id,
    title: row.title,
    folder: row.folder,
    format: row.format,
    pageCount: row.page_count,
    size: row.size,
    dateAdded: row.date_added,
    resumePage: row.resume_page ?? 0,
    progressUpdatedAt: row.progress_updated_at ?? null,
  };
}

export class BookDatabase {
  private readonly db: Database.Database;
  private readonly stUpsert: Database.Statement<unknown[]>;
  private readonly stGetById: Database.Statement<[string]>;
  private readonly stGetByPath: Database.Statement<[string]>;
  private readonly stDeleteById: Database.Statement<[string]>;
  /** Cache of pre-built folder pages, keyed by folder ID. Built lazily on
   *  first browse and invalidated after every scan. */
  private folderPageCache: Map<string, BookFolderPage> | null = null;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(BOOK_SCHEMA);

    this.stUpsert = this.db.prepare(`
      INSERT INTO books (
        id, file_path, rel_path, title, folder, format, page_count,
        size, mtime, date_added, scanned_at
      ) VALUES (
        @id, @file_path, @rel_path, @title, @folder, @format, @page_count,
        @size, @mtime, @date_added, @scanned_at
      )
      ON CONFLICT(id) DO UPDATE SET
        file_path=excluded.file_path,
        rel_path=excluded.rel_path,
        title=excluded.title,
        folder=excluded.folder,
        format=excluded.format,
        page_count=excluded.page_count,
        size=excluded.size,
        mtime=excluded.mtime,
        scanned_at=excluded.scanned_at
    `);
    this.stGetById = this.db.prepare('SELECT * FROM books WHERE id = ?');
    this.stGetByPath = this.db.prepare('SELECT * FROM books WHERE file_path = ?');
    this.stDeleteById = this.db.prepare('DELETE FROM books WHERE id = ?');
  }

  upsert(row: BookRow): void {
    this.stUpsert.run(row);
  }

  getRowById(id: string): BookRow | undefined {
    return this.stGetById.get(id) as BookRow | undefined;
  }

  getRowByPath(filePath: string): BookRow | undefined {
    return this.stGetByPath.get(filePath) as BookRow | undefined;
  }

  deleteById(id: string): void {
    this.stDeleteById.run(id);
  }

  getBook(id: string): Book | undefined {
    const row = this.db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(id) as
      | PublicBookRow
      | undefined;
    return row ? rowToBook(row) : undefined;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n;
  }

  list(opts: {
    sort?: BookSortKey;
    order?: SortOrder;
    page?: number;
    limit?: number;
    search?: string;
  } = {}): PageResult<Book> {
    const sort = BOOK_SORT[opts.sort ?? 'recently_added'] ?? BOOK_SORT.recently_added;
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 36));
    const offset = (page - 1) * limit;
    const params: Record<string, unknown> = { limit, offset };

    let where = '';
    if (opts.search) {
      where = 'WHERE LOWER(b.title) LIKE @query OR LOWER(b.folder) LIKE @query';
      params.query = `%${opts.search.toLowerCase()}%`;
    }

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM books b ${where}`).get(params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `${BOOK_SELECT} ${where}
         ORDER BY ${sort} ${order}, b.title COLLATE NOCASE ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params) as PublicBookRow[];

    return {
      items: rows.map(rowToBook),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /** Invalidate the folder-page cache. Call after any mutation (scan, etc.). */
  invalidateFolderCache(): void {
    this.folderPageCache = null;
  }

  browseFolder(requestedId = ROOT_FOLDER_ID): BookFolderPage | null {
    // Serve from cache when available — avoids re-querying all books on
    // every folder navigation.
    if (this.folderPageCache) {
      return this.folderPageCache.get(requestedId) ?? null;
    }

    // Build all folder pages in one pass and cache them.
    const rows = this.db
      .prepare(`${BOOK_SELECT} ORDER BY b.title COLLATE NOCASE ASC`)
      .all() as PublicBookRow[];

    // Build set of all valid directory IDs.
    const directoryIds = new Map<string, string>([[ROOT_FOLDER_ID, '']]);
    for (const row of rows) {
      const directory = normalizeDirectory(path.dirname(row.rel_path));
      if (!directory) continue;
      const parts = directory.split('/');
      for (let index = 1; index <= parts.length; index++) {
        const value = parts.slice(0, index).join('/');
        directoryIds.set(folderId(value), value);
      }
    }

    // Pre-build every folder page and cache by ID.
    const cache = new Map<string, BookFolderPage>();
    for (const [dirId, currentDirectory] of directoryIds) {
      const childFolders = new Map<
        string,
        { directory: string; name: string; bookCount: number; subfolders: Set<string>; thumbnailBookId: string | null }
      >();
      const books: Book[] = [];

      for (const row of rows) {
        const rowDirectory = normalizeDirectory(path.dirname(row.rel_path));
        const relativeDirectory = currentDirectory
          ? path.posix.relative(currentDirectory, rowDirectory)
          : rowDirectory;
        if (relativeDirectory.startsWith('..')) continue;

        if (!relativeDirectory) {
          books.push(rowToBook(row));
          continue;
        }

        const childName = relativeDirectory.split('/')[0];
        const childDirectory = currentDirectory
          ? `${currentDirectory}/${childName}`
          : childName;
        const child = childFolders.get(childDirectory) ?? {
          directory: childDirectory,
          name: childName,
          bookCount: 0,
          subfolders: new Set<string>(),
          thumbnailBookId: null,
        };
        child.bookCount++;
        const nestedName = relativeDirectory.split('/')[1];
        if (nestedName) child.subfolders.add(nestedName);
        child.thumbnailBookId ??= row.id;
        childFolders.set(childDirectory, child);
      }

      const parts = currentDirectory ? currentDirectory.split('/') : [];
      const breadcrumbs: BookFolderCrumb[] = [
        { id: ROOT_FOLDER_ID, name: 'Books' },
        ...parts.map((name, index) => {
          const directory = parts.slice(0, index + 1).join('/');
          return { id: folderId(directory), name };
        }),
      ];

      cache.set(dirId, {
        current: breadcrumbs[breadcrumbs.length - 1],
        breadcrumbs,
        folders: [...childFolders.values()]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          .map((folder): BookFolder => ({
            id: folderId(folder.directory),
            name: folder.name,
            bookCount: folder.bookCount,
            subfolderCount: folder.subfolders.size,
            thumbnailBookId: folder.thumbnailBookId,
          })),
        books: books.sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { numeric: true }),
        ),
      });
    }

    this.folderPageCache = cache;
    return cache.get(requestedId) ?? null;
  }

  continueReading(limit = 12): Book[] {
    const rows = this.db
      .prepare(
        `${BOOK_SELECT}
         WHERE p.page >= 3
           AND p.page < b.page_count * 0.95
         ORDER BY p.updated_at DESC
         LIMIT ?`,
      )
      .all(Math.min(50, Math.max(1, limit))) as PublicBookRow[];
    return rows.map(rowToBook);
  }

  saveProgress(bookId: string, page: number): BookProgress | null {
    const book = this.getRowById(bookId);
    if (!book) return null;

    const safePage = Math.max(1, Math.min(page, book.page_count));
    if (safePage <= 2 || safePage >= book.page_count * 0.95) {
      this.db.prepare('DELETE FROM book_progress WHERE book_id = ?').run(bookId);
      return { bookId, page: 0, updatedAt: Date.now() };
    }

    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO book_progress (book_id, page, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           page=excluded.page,
           updated_at=excluded.updated_at`,
      )
      .run(bookId, safePage, updatedAt);
    return { bookId, page: safePage, updatedAt };
  }

  clearProgress(bookId: string): void {
    this.db.prepare('DELETE FROM book_progress WHERE book_id = ?').run(bookId);
  }

  pruneMissing(keepPaths: Set<string>): number {
    const rows = this.db.prepare('SELECT id, file_path FROM books').all() as {
      id: string;
      file_path: string;
    }[];
    let removed = 0;
    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        if (!keepPaths.has(row.file_path)) {
          this.stDeleteById.run(row.id);
          removed++;
        }
      }
    });
    transaction();
    return removed;
  }

  summary(configured: boolean): BookSummary {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS bookCount,
          COALESCE(SUM(page_count), 0) AS totalPages
         FROM books`,
      )
      .get() as { bookCount: number; totalPages: number };
    return {
      configured,
      bookCount: row.bookCount,
      totalPages: row.totalPages,
    };
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
