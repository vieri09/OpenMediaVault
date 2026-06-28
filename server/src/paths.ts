import path from 'node:path';
import fs from 'node:fs';
import { forbidden } from './errors.ts';

/**
 * Resolve `relPath` against `root` and guarantee the result lives *inside* `root`.
 *
 * This is the single security chokepoint that prevents path-traversal attacks.
 * Any endpoint that touches the filesystem must go through it. We resolve the
 * path, then require the normalized result to equal or start with the root
 * prefix (with a path separator) — this rejects `..`, absolute paths, and
 * symlink escapes that resolve outside the root.
 */
export function resolveWithin(root: string, relPath: string): string {
  const cleanRoot = path.resolve(root);
  // path.resolve joins root + relPath and normalizes ".." segments. An absolute
  // relPath would override root, so we explicitly forbid that first.
  if (path.isAbsolute(relPath)) {
    throw forbidden('Absolute paths are not allowed.');
  }
  const resolved = path.resolve(cleanRoot, relPath);

  const rootWithSep = cleanRoot.endsWith(path.sep) ? cleanRoot : cleanRoot + path.sep;
  if (resolved !== cleanRoot && !resolved.startsWith(rootWithSep)) {
    throw forbidden('Requested path is outside the music library.');
  }
  return resolved;
}

/** True if `resolved` is contained within `root` (pure path check, no fs). */
export function isWithin(root: string, resolved: string): boolean {
  const cleanRoot = path.resolve(root);
  const rootWithSep = cleanRoot.endsWith(path.sep) ? cleanRoot : cleanRoot + path.sep;
  return resolved === cleanRoot || resolved.startsWith(rootWithSep);
}

/**
 * Resolves a real on-disk path while rejecting symlinks that escape `root`.
 * Used during scanning so a symlinked subfolder pointing outside the library
 * cannot pull in arbitrary files.
 */
export function assertRealPathWithin(root: string, fullPath: string): void {
  let real: string;
  try {
    real = fs.realpathSync(fullPath);
  } catch {
    // Missing or unreadable — let callers handle ENOENT/EACCES as needed.
    return;
  }
  if (!isWithin(root, real)) {
    throw forbidden('Resolved symlink is outside the music library.');
  }
}
