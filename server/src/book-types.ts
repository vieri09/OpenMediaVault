export type BookSortKey = 'title' | 'recently_added' | 'page_count';

export interface Book {
  id: string;
  title: string;
  folder: string;
  format: string;
  pageCount: number;
  size: number;
  dateAdded: number;
  resumePage: number;
  progressUpdatedAt: number | null;
}

export interface BookProgress {
  bookId: string;
  page: number;
  updatedAt: number;
}

export interface BookSummary {
  configured: boolean;
  bookCount: number;
  totalPages: number;
}

export interface BookFolder {
  id: string;
  name: string;
  bookCount: number;
  subfolderCount: number;
  thumbnailBookId: string | null;
}

export interface BookFolderCrumb {
  id: string;
  name: string;
}

export interface BookFolderPage {
  current: BookFolderCrumb;
  breadcrumbs: BookFolderCrumb[];
  folders: BookFolder[];
  books: Book[];
}
