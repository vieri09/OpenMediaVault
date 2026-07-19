import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { describe, it } from 'vitest';

/**
 * Test helpers for building a throwaway music library on disk.
 */

/** Create a fresh temp dir, returning its path. */
export async function makeTempDir(prefix = 'openmedia-test-'): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Recursively remove a directory, ignoring missing files. */
export async function rmrf(target: string): Promise<void> {
  await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
}

/** Check whether ffmpeg is available on PATH. */
export function hasFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(args: string[]): Promise<string> {
  const out = args[args.length - 1];
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
    proc.on('error', () => reject(new Error('ffmpeg is required for these tests but was not found.')));
    proc.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

/** Write a minimal silent MP3 with ID3 metadata (requires ffmpeg on PATH). */
export async function makeMp3(
  dir: string,
  relPath: string,
  meta: { title?: string; artist?: string; album?: string; track?: string; date?: string; genre?: string } = {},
): Promise<string> {
  const abs = path.join(dir, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-ac', '1', '-ar', '44100', '-b:a', '96k',
  ];
  if (meta.title) args.push('-metadata', `title=${meta.title}`);
  if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
  if (meta.album) args.push('-metadata', `album=${meta.album}`);
  if (meta.artist) args.push('-metadata', `album_artist=${meta.artist}`);
  if (meta.genre) args.push('-metadata', `genre=${meta.genre}`);
  if (meta.date) args.push('-metadata', `date=${meta.date}`);
  if (meta.track) args.push('-metadata', `track=${meta.track}`);
  args.push(abs);
  return runFfmpeg(args);
}

/** Write a minimal ALAC-in-M4A file to exercise the compatibility path. */
export async function makeAlacM4a(
  dir: string,
  relPath: string,
  meta: { title?: string; artist?: string; album?: string } = {},
): Promise<string> {
  const abs = path.join(dir, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=550:duration=1',
    '-ac', '1', '-ar', '44100',
    '-c:a', 'alac',
  ];
  if (meta.title) args.push('-metadata', `title=${meta.title}`);
  if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
  if (meta.album) args.push('-metadata', `album=${meta.album}`);
  args.push(abs);
  return runFfmpeg(args);
}

/** Write a tiny local movie fixture in the requested container. */
export async function makeVideo(
  dir: string,
  relPath: string,
  opts: {
    videoCodec?: 'h264' | 'mpeg4';
    duration?: number;
    subtitleTracks?: number;
  } = {},
): Promise<string> {
  const abs = path.join(dir, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const codec = opts.videoCodec === 'mpeg4' ? 'mpeg4' : 'libx264';
  const subtitleTracks = Math.max(0, opts.subtitleTracks ?? 0);
  const subtitleFile = path.join(path.dirname(abs), '.fixture-subtitle.srt');
  if (subtitleTracks > 0) {
    await fsp.writeFile(
      subtitleFile,
      '1\n00:00:00,250 --> 00:00:01,750\nFixture subtitle text\n',
      'utf8',
    );
  }
  const args = [
    '-y',
    '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=24:duration=${opts.duration ?? 2}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${opts.duration ?? 2}`,
  ];
  if (subtitleTracks > 0) args.push('-f', 'srt', '-i', subtitleFile);
  args.push(
    '-map', '0:v:0',
    '-map', '1:a:0',
  );
  for (let index = 0; index < subtitleTracks; index++) args.push('-map', '2:s:0');
  args.push(
    '-pix_fmt', 'yuv420p',
    '-c:v', codec,
    '-c:a', 'aac',
    '-b:a', '96k',
  );
  if (codec === 'libx264') args.push('-preset', 'ultrafast', '-g', '24');
  if (subtitleTracks > 0) {
    args.push('-c:s', path.extname(abs).toLowerCase() === '.mp4' ? 'mov_text' : 'srt');
  }
  args.push(abs);
  return runFfmpeg(args);
}

/** Write an MP3 that embeds a tiny cover image. */
export async function makeMp3WithCover(
  dir: string,
  relPath: string,
  meta: { title?: string; artist?: string; album?: string } = {},
): Promise<string> {
  const abs = path.join(dir, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1',
    '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1',
    '-ac', '1', '-ar', '44100', '-b:a', '96k',
    '-map', '0:a', '-map', '1:v',
    '-disposition:v', 'attached_pic',
    '-id3v2_version', '3',
  ];
  if (meta.title) args.push('-metadata', `title=${meta.title}`);
  if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
  if (meta.album) args.push('-metadata', `album=${meta.album}`);
  if (meta.artist) args.push('-metadata', `album_artist=${meta.artist}`);
  args.push(abs);
  return runFfmpeg(args);
}

/** Run a describe block only when ffmpeg is available; otherwise skip it. */
export function describeWithFfmpeg(name: string, fn: () => void): void {
  if (hasFfmpeg()) {
    describe(name, fn);
  } else {
    describe.skip(name, () => {
      it('requires ffmpeg (skipped)', () => {
        /* skipped */
      });
    });
  }
}
