import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { log } from './logger.ts';
import { resolveWithin } from './paths.ts';
import { parseRange } from './stream.ts';

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
};
const VIDEO_READ_BUFFER_BYTES = 1024 * 1024;

export function streamVideo(root: string, relPath: string, req: Request, res: Response): void {
  let absPath: string;
  try {
    absPath = resolveWithin(root, relPath);
  } catch {
    res.status(403).json({ error: 'Path is outside the movie library.', code: 'FORBIDDEN' });
    return;
  }

  fs.stat(absPath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.status(404).json({ error: 'Movie file not found.', code: 'MOVIE_FILE_NOT_FOUND' });
      return;
    }

    const range = parseRange(req.headers.range, stat.size);
    const contentType = VIDEO_MIME[path.extname(absPath).slice(1).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const pipe = (stream: fs.ReadStream): void => {
      stream.on('error', (err) => {
        log.error(`Movie stream failed for "${relPath}": ${err.message}`);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });
      stream.pipe(res);
    };

    if (range) {
      const length = range.end - range.start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
      res.setHeader('Content-Length', String(length));
      pipe(fs.createReadStream(absPath, {
        start: range.start,
        end: range.end,
        highWaterMark: VIDEO_READ_BUFFER_BYTES,
      }));
      return;
    }

    res.status(200);
    res.setHeader('Content-Length', String(stat.size));
    pipe(fs.createReadStream(absPath, { highWaterMark: VIDEO_READ_BUFFER_BYTES }));
  });
}
