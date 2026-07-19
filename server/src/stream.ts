import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';
import mime from 'mime-types';
import { parseFile } from 'music-metadata';
import { resolveWithin } from './paths.ts';
import { log } from './logger.ts';
import type { TrackRow } from './db.ts';

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

const codecChecks = new Map<string, Promise<boolean>>();
const activeTranscodes = new Map<string, Promise<string>>();
let losslessTranscodeQueue: Promise<void> = Promise.resolve();

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
 * Return whether an M4A file needs a browser-compatible rendition.
 *
 * M4A is only a container: it commonly contains AAC (widely supported) but can
 * also contain ALAC (not decoded by every browser). Cache the result using
 * the scanner's size + mtime signature so normal playback does not repeatedly
 * parse the file header.
 */
async function needsM4aTranscode(absPath: string, track: TrackRow): Promise<boolean> {
  if (track.format !== 'm4a') return false;

  const key = `${absPath}:${track.size}:${Math.round(track.mtime)}`;
  let check = codecChecks.get(key);
  if (!check) {
    check = parseFile(absPath, { duration: false, skipCovers: true })
      .then((metadata) => metadata.format.codec?.toLowerCase() === 'alac')
      .catch((err: unknown) => {
        log.warn(`Could not inspect M4A codec for "${track.rel_path}": ${(err as Error).message}`);
        return false;
      });
    codecChecks.set(key, check);
  }
  return check;
}

function runLosslessTranscode(source: string, target: string): Promise<void> {
  const temporary = `${target}.part-${process.pid}`;
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', source,
        '-map', '0:a:0',
        '-vn',
        '-c:a', 'flac',
        '-compression_level', '8',
        '-threads', '1',
        '-f', 'flac',
        temporary,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    let stderr = '';
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    ffmpeg.on('error', (err) => {
      void fsp.rm(temporary, { force: true });
      reject(new Error(`Could not start ffmpeg: ${err.message}`));
    });
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        void fsp.rm(temporary, { force: true });
        reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      fsp.rename(temporary, target).then(() => resolve(), reject);
    });
  });
}

/** Serialize CPU-heavy conversions so a burst of tracks cannot saturate the host. */
function queuedLosslessTranscode(source: string, target: string): Promise<void> {
  const queued = losslessTranscodeQueue.then(() => runLosslessTranscode(source, target));
  losslessTranscodeQueue = queued.catch(() => {
    // Keep the queue usable after a failed conversion; the caller gets the error.
  });
  return queued;
}

async function compatibleM4a(cacheRoot: string, source: string, track: TrackRow): Promise<string> {
  await fsp.mkdir(cacheRoot, { recursive: true });
  const filename = `${track.id}-${track.size}-${Math.round(track.mtime)}.flac`;
  const target = path.join(cacheRoot, filename);

  try {
    if ((await fsp.stat(target)).isFile()) return filename;
  } catch {
    // Cache miss.
  }

  let transcode = activeTranscodes.get(target);
  if (!transcode) {
    transcode = (async () => {
      log.info(`Creating browser-compatible lossless FLAC cache for "${track.rel_path}"…`);
      await queuedLosslessTranscode(source, target);
      log.info(`Lossless FLAC cache ready for "${track.rel_path}".`);

      // A changed source gets a new signature. Remove older renditions for the
      // same stable track ID only after the new file has completed atomically.
      const entries = await fsp.readdir(cacheRoot);
      await Promise.all(
        entries
          .filter((entry) => entry.startsWith(`${track.id}-`) && entry !== filename)
          .map((entry) => fsp.rm(path.join(cacheRoot, entry), { force: true })),
      );
      return filename;
    })().finally(() => activeTranscodes.delete(target));
    activeTranscodes.set(target, transcode);
  }
  return transcode;
}

/**
 * Stream a track directly when the browser can decode it. ALAC-in-M4A tracks
 * are converted losslessly to FLAC once and served from a range-capable cache.
 */
export async function streamTrackAudio(
  root: string,
  cacheRoot: string,
  track: TrackRow,
  req: Request,
  res: Response,
): Promise<void> {
  const absPath = resolveWithin(root, track.rel_path);
  if (!(await needsM4aTranscode(absPath, track))) {
    streamAudio(root, track.rel_path, req, res);
    return;
  }

  try {
    const cachedFile = await compatibleM4a(cacheRoot, absPath, track);
    res.setHeader('X-OpenMedia-Transcoded', 'alac-to-flac-lossless');
    streamAudio(cacheRoot, cachedFile, req, res);
  } catch (err) {
    log.error(`Could not create FLAC cache for "${track.rel_path}": ${(err as Error).message}`);
    // Safari can play ALAC directly, so preserve that useful fallback when
    // ffmpeg is unavailable instead of turning a playable request into a 500.
    streamAudio(root, track.rel_path, req, res);
  }
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
