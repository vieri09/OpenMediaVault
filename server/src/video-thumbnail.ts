import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { MovieRow } from './video-db.ts';

const jobs = new Map<string, Promise<string>>();
const waiters: Array<() => void> = [];
let active = 0;
const MAX_THUMBNAILS = 2;

async function acquire(): Promise<void> {
  if (active < MAX_THUMBNAILS) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiters.shift()?.();
}

function renderThumbnail(source: string, target: string, duration: number): Promise<void> {
  const temporary = `${target}.part-${process.pid}.jpg`;
  const seek = Math.max(0, Math.min(120, duration > 2 ? duration * 0.1 : 0));
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(seek),
        '-i',
        source,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '4',
        temporary,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    const timeout = setTimeout(() => proc.kill('SIGKILL'), 30_000);
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2048);
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start ffmpeg: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        void fsp.rm(temporary, { force: true });
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      fsp.rename(temporary, target).then(() => resolve(), reject);
    });
  });
}

export async function movieThumbnail(
  cacheRoot: string,
  source: string,
  movie: MovieRow,
): Promise<string> {
  await fsp.mkdir(cacheRoot, { recursive: true });
  const filename = `${movie.id}-${movie.size}-${Math.round(movie.mtime)}.jpg`;
  const target = path.join(cacheRoot, filename);
  try {
    if ((await fsp.stat(target)).isFile()) return target;
  } catch {
    // Cache miss.
  }

  let job = jobs.get(target);
  if (!job) {
    job = (async () => {
      await acquire();
      try {
        await renderThumbnail(source, target, movie.duration);
        const oldEntries = await fsp.readdir(cacheRoot);
        await Promise.all(
          oldEntries
            .filter((entry) => entry.startsWith(`${movie.id}-`) && entry !== filename)
            .map((entry) => fsp.rm(path.join(cacheRoot, entry), { force: true })),
        );
        return target;
      } finally {
        release();
      }
    })().finally(() => jobs.delete(target));
    jobs.set(target, job);
  }
  return job;
}
