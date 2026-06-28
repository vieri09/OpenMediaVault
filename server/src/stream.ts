import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import mime from 'mime-types';
import { resolveWithin } from './paths.ts';
import { log } from './logger.ts';

const FALLBACK_MIME: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  wma: 'audio/x-ms-wma',
};

/** Best-effort content-type for an audio extension. */
export function audioMime(absPath: string): string {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  return FALLBACK_MIME[ext] ?? (mime.lookup(ext) || 'application/octet-stream');
}

export interface RangeSpec {
  start: number;
  end: number;
  total: number;
}

/** Parse a Range header into a [start,end] given a file size, or null if absent. */
export function parseRange(rangeHeader: string | undefined, size: number): RangeSpec | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const spec = rangeHeader.slice('bytes='.length).trim();
  const [startStr, endStr] = spec.split('-');
  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range: last N bytes
    const n = Number.parseInt(endStr, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0 || start >= size) return null;
    end = endStr === '' ? size - 1 : Number.parseInt(endStr, 10);
    if (!Number.isFinite(end) || end >= size) end = size - 1;
    if (end < start) return null;
  }
  return { start, end, total: size };
}

/**
 * Stream an audio file with full HTTP Range support.
 * `relPath` must be relative to the library root and already validated.
 *
 * Because this is invoked from an Express route and `fs.stat` is async, we send
 * error responses directly rather than throwing (a throw inside the stat
 * callback would escape Express's error handling).
 */
export function streamAudio(root: string, relPath: string, req: Request, res: Response): void {
  let absPath: string;
  try {
    absPath = resolveWithin(root, relPath);
  } catch {
    res.status(403).json({ error: 'Path is outside the music library.', code: 'FORBIDDEN' });
    return;
  }

  fs.stat(absPath, (statErr, stat) => {
    if (statErr) {
      if (statErr.code === 'ENOENT') {
        res.status(404).json({ error: 'Audio file not found on disk.', code: 'FILE_NOT_FOUND' });
      } else if (statErr.code === 'EACCES') {
        res.status(403).json({ error: 'No permission to read this audio file.', code: 'FORBIDDEN' });
      } else {
        log.error(`stat error for "${relPath}": ${statErr.message}`);
        res.status(500).json({ error: 'Could not read file.', code: 'INTERNAL' });
      }
      return;
    }
    if (!stat.isFile()) {
      res.status(404).json({ error: 'Requested path is not a file.', code: 'NOT_FOUND' });
      return;
    }

    const contentType = audioMime(absPath);
    const range = parseRange(req.headers.range, stat.size);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    // Encourage the browser to cache immutable audio bytes.
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const pipeStream = (stream: fs.ReadStream): void => {
      stream.on('error', (e: NodeJS.ErrnoException) => {
        log.error(`Stream error for "${relPath}": ${e.message}`);
        if (!res.headersSent) res.status(500).end();
        else res.end();
        stream.destroy();
      });
      stream.pipe(res);
    };

    if (range) {
      const chunkSize = range.end - range.start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
      res.setHeader('Content-Length', String(chunkSize));
      pipeStream(fs.createReadStream(absPath, { start: range.start, end: range.end }));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(stat.size));
      pipeStream(fs.createReadStream(absPath));
    }
  });
}
