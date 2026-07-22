import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { MovieRow } from './video-db.ts';
import { log } from './logger.ts';
import type { MovieMediaTrack } from './video-types.ts';

const SESSION_TTL = 15 * 60 * 1000;
const STOPPED_SESSION_TTL = 60 * 1000;
const MAX_SESSIONS = 1;
const HLS_SEGMENT_SECONDS = 2;
const STARTUP_BUFFER_SECONDS = 5;
const STARTUP_SEGMENT_COUNT = 2;
const SUBTITLE_BUCKET_SECONDS = 5 * 60;
const SUBTITLE_WINDOW_SECONDS = 10 * 60;
const SUBTITLE_LEAD_SECONDS = 15;
const hdrChecks = new Map<string, boolean>();

interface VideoSession {
  movieId: string;
  playbackSessionId: string;
  source: string;
  sourceMtime: number;
  sourceSize: number;
  dir: string;
  start: number;
  process: ChildProcess | null;
  subtitleStreamIndexes: Set<number>;
  audioStreamIndex: number;
  sourceVideo: boolean;
  lastAccess: number;
  done: boolean;
  error: string | null;
  startHintServed: boolean;
}

export interface VideoPlaylist {
  file: string;
  includeStartHint: boolean;
}

function encoderAvailable(name: string): boolean {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    maxBuffer: 2_000_000,
  });
  return result.status === 0 && result.stdout.includes(name);
}

const HAS_VIDEOTOOLBOX = process.platform === 'darwin' && encoderAvailable('h264_videotoolbox');

function sourceNeedsToneMap(source: string): boolean {
  const cached = hdrChecks.get(source);
  if (cached !== undefined) return cached;
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=color_transfer,color_primaries',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      source,
    ],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 64_000 },
  );
  const metadata = result.status === 0 ? result.stdout.toLowerCase() : '';
  const hdr =
    metadata.includes('smpte2084') ||
    metadata.includes('arib-std-b67') ||
    metadata.includes('bt2020');
  hdrChecks.set(source, hdr);
  return hdr;
}

function waitForFile(
  file: string,
  timeoutMs: number,
  failed: () => boolean = () => false,
): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = (): void => {
      try {
        if (fs.statSync(file).size > 0) {
          resolve(true);
          return;
        }
      } catch {
        // Not written yet.
      }
      if (failed()) {
        resolve(false);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

function waitForStartupBuffer(session: VideoSession, timeoutMs: number): Promise<boolean> {
  const playlist = path.join(session.dir, 'index.m3u8');
  return new Promise((resolve) => {
    const started = Date.now();
    const check = (): void => {
      let playlistReady = false;
      let bufferReady = false;
      try {
        const contents = fs.readFileSync(playlist, 'utf8');
        playlistReady = contents.length > 0;
        const bufferedSeconds = [...contents.matchAll(/#EXTINF:([\d.]+)/g)]
          .reduce((total, match) => total + (Number.parseFloat(match[1]) || 0), 0);
        const segmentCount = (contents.match(/#EXTINF:/g) ?? []).length;
        bufferReady =
          segmentCount >= STARTUP_SEGMENT_COUNT &&
          bufferedSeconds >= STARTUP_BUFFER_SECONDS;
      } catch {
        // Playlist is not written yet.
      }
      if (playlistReady && (bufferReady || session.done)) {
        resolve(true);
        return;
      }
      if (session.error) {
        resolve(false);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        // Degrade to the segments already available on unusually slow hardware.
        resolve(playlistReady);
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

function parseTracks(raw: string): MovieMediaTrack[] {
  try {
    const parsed = JSON.parse(raw) as MovieMediaTrack[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function highQualityVideoBitrate(height: number): {
  average: string;
  maximum: string;
  buffer: string;
} {
  if (height > 1440) return { average: '45M', maximum: '60M', buffer: '90M' };
  if (height > 1080) return { average: '28M', maximum: '38M', buffer: '56M' };
  if (height > 720) return { average: '16M', maximum: '22M', buffer: '32M' };
  return { average: '8M', maximum: '12M', buffer: '16M' };
}

function transcodeArgs(
  source: string,
  dir: string,
  movie: MovieRow,
  start: number,
  audioStreamIndex: number,
  sourceVideo: boolean,
): string[] {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'];
  if (start > 0) args.push('-ss', String(start));
  args.push(
    '-i',
    source,
    '-map',
    '0:v:0',
    '-map',
    audioStreamIndex >= 0 ? `0:${audioStreamIndex}?` : '0:a:0?',
  );
  const audioTracks = parseTracks(movie.audio_tracks);
  const selectedAudio =
    audioTracks.find((track) => track.streamIndex === audioStreamIndex) ?? audioTracks[0];
  const toneMap = !sourceVideo && sourceNeedsToneMap(source);
  const compatibilityFilter = toneMap
    ? 'format=gbrpf32le,tonemap=mobius:desat=0:peak=10,format=yuv420p,' +
      'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
    : null;

  if (
    sourceVideo &&
    (movie.video_codec === 'hevc' || movie.video_codec === 'h265')
  ) {
    args.push('-c:v', 'copy', '-tag:v', 'hvc1');
  } else if (movie.video_codec === 'h264' && movie.video_copyable === 1) {
    args.push('-c:v', 'copy');
  } else if (HAS_VIDEOTOOLBOX) {
    const bitrate = highQualityVideoBitrate(movie.height);
    if (compatibilityFilter) args.push('-vf', compatibilityFilter);
    args.push(
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'h264_videotoolbox',
      '-profile:v',
      'high',
      '-coder',
      'cabac',
      '-spatial_aq',
      '1',
      '-allow_sw',
      '1',
      '-b:v',
      bitrate.average,
      '-maxrate',
      bitrate.maximum,
      '-bufsize',
      bitrate.buffer,
      '-g',
      '48',
    );
    if (toneMap) {
      args.push(
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        '-color_range',
        'tv',
      );
    }
  } else {
    if (compatibilityFilter) args.push('-vf', compatibilityFilter);
    args.push(
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-profile:v',
      'high',
      '-threads',
      '0',
      '-g',
      '48',
      '-keyint_min',
      '48',
      '-sc_threshold',
      '0',
    );
    if (toneMap) {
      args.push(
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        '-color_range',
        'tv',
      );
    }
  }

  if (selectedAudio) {
    args.push(
      '-af',
      'aresample=async=1:first_pts=0',
      '-ac',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
    );
  }

  args.push(
    '-sn',
    '-max_muxing_queue_size',
    '2048',
    '-avoid_negative_ts',
    'make_zero',
    '-f',
    'hls',
    '-hls_time',
    String(HLS_SEGMENT_SECONDS),
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_fmp4_init_resend',
    '1',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_filename',
    path.join(dir, 'seg_%05d.m4s'),
    path.join(dir, 'index.m3u8'),
  );
  return args;
}

function subtitleArgs(
  source: string,
  outputFile: string,
  streamIndex: number,
  startAt = 0,
  duration = 0,
): string[] {
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
  ];
  if (startAt > 0) args.push('-ss', String(startAt));
  args.push(
    '-i',
    source,
    '-map',
    `0:${streamIndex}`,
  );
  if (duration > 0) args.push('-t', String(duration));
  args.push(
    '-c:s',
    'webvtt',
    '-map_metadata',
    '-1',
    '-f',
    'webvtt',
    outputFile,
  );
  return args;
}

function parseVttTime(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatVttTime(value: number): string {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
}

function shiftWebVtt(raw: string, offset: number): string {
  if (Math.abs(offset) < 0.001) return raw;
  const blocks = raw.replace(/\r/g, '').split(/\n{2,}/);
  const output = ['WEBVTT'];
  const cuePattern =
    /^((?:\d{2,}:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})(.*)$/;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed === 'WEBVTT') continue;
    const lines = trimmed.split('\n');
    const timingIndex = lines.findIndex((line) => cuePattern.test(line));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(cuePattern);
    if (!match) continue;
    const start = parseVttTime(match[1]) + offset;
    const end = parseVttTime(match[2]) + offset;
    if (end <= 0) continue;
    lines[timingIndex] =
      `${formatVttTime(Math.max(0, start))} --> ` +
      `${formatVttTime(end)}${match[3]}`;
    output.push(lines.join('\n'));
  }
  return `${output.join('\n\n')}\n`;
}

function retimeWebVtt(raw: string, offset: number): string {
  return shiftWebVtt(raw, -offset);
}

export class VideoTranscoder {
  private readonly root: string;
  private readonly subtitleRoot: string;
  private readonly sessions = new Map<string, VideoSession>();
  private readonly stoppedSessions = new Map<string, number>();
  private readonly subtitleProcesses = new Map<string, ChildProcess>();
  private readonly subtitleFailures = new Set<string>();
  private readonly sweep: NodeJS.Timeout;

  constructor(instanceKey: string) {
    const suffix = crypto.createHash('sha1').update(instanceKey).digest('hex').slice(0, 12);
    this.root = path.join(os.tmpdir(), `openmedia-hls-${suffix}`);
    this.subtitleRoot = path.join(path.dirname(instanceKey), 'movie-subtitles');
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.subtitleRoot, { recursive: true });
    this.sweep = setInterval(() => this.evictIdle(), 60_000);
    this.sweep.unref();
  }

  private directory(movieId: string): string {
    return path.join(this.root, movieId);
  }

  private kill(movieId: string): void {
    const session = this.sessions.get(movieId);
    if (!session) return;
    this.sessions.delete(movieId);
    try {
      session.process?.kill('SIGKILL');
    } catch {
      // Best effort.
    }
    void fsp.rm(session.dir, { recursive: true, force: true });
  }

  private evictOldest(): void {
    if (this.sessions.size < MAX_SESSIONS) return;
    let oldest: VideoSession | undefined;
    for (const session of this.sessions.values()) {
      if (!oldest || session.lastAccess < oldest.lastAccess) oldest = session;
    }
    if (oldest) this.kill(oldest.movieId);
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (now - session.lastAccess > SESSION_TTL) this.kill(session.movieId);
    }
    for (const [sessionId, stoppedAt] of this.stoppedSessions) {
      if (now - stoppedAt > STOPPED_SESSION_TTL) this.stoppedSessions.delete(sessionId);
    }
  }

  async ensure(
    movie: MovieRow,
    source: string,
    startAt = 0,
    requestedAudioStream = -1,
    sourceVideo = false,
    playbackSessionId = 'legacy',
  ): Promise<VideoSession | null> {
    if (this.stoppedSessions.has(playbackSessionId)) return null;
    const start = Math.max(0, Math.floor(startAt));
    const audioTracks = parseTracks(movie.audio_tracks);
    const audioStreamIndex = audioTracks.some(
      (track) => track.streamIndex === requestedAudioStream,
    )
      ? requestedAudioStream
      : (audioTracks[0]?.streamIndex ?? -1);
    const existing = this.sessions.get(movie.id);
    if (
      existing &&
      existing.playbackSessionId === playbackSessionId &&
      existing.start === start &&
      existing.audioStreamIndex === audioStreamIndex &&
      existing.sourceVideo === sourceVideo
    ) {
      existing.lastAccess = Date.now();
      return existing;
    }
    if (existing) this.kill(movie.id);
    this.evictOldest();

    const dir = this.directory(movie.id);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    if (this.stoppedSessions.has(playbackSessionId)) return null;
    const session: VideoSession = {
      movieId: movie.id,
      playbackSessionId,
      source,
      sourceMtime: movie.mtime,
      sourceSize: movie.size,
      dir,
      start,
      process: null,
      subtitleStreamIndexes: new Set(
        parseTracks(movie.subtitle_tracks).map((track) => track.streamIndex),
      ),
      audioStreamIndex,
      sourceVideo,
      lastAccess: Date.now(),
      done: false,
      error: null,
      startHintServed: false,
    };
    const proc = spawn(
      'ffmpeg',
      transcodeArgs(source, dir, movie, start, audioStreamIndex, sourceVideo),
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    session.process = proc;
    this.sessions.set(movie.id, session);
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    proc.on('error', (err) => {
      session.done = true;
      session.error = err.message;
    });
    proc.on('close', (code) => {
      session.done = true;
      session.process = null;
      if (code && !fs.existsSync(path.join(dir, 'index.m3u8'))) {
        session.error = stderr.trim() || `ffmpeg exited with code ${code}`;
        log.error(`Movie transcode failed for "${movie.title}": ${session.error}`);
      }
    });

    return session;
  }

  async playlist(
    movie: MovieRow,
    source: string,
    startAt: number,
    audioStreamIndex = -1,
    sourceVideo = false,
    playbackSessionId = 'legacy',
  ): Promise<VideoPlaylist | null> {
    const session = await this.ensure(
      movie,
      source,
      startAt,
      audioStreamIndex,
      sourceVideo,
      playbackSessionId,
    );
    if (!session) return null;
    const playlist = path.join(session.dir, 'index.m3u8');
    if (!(await waitForStartupBuffer(session, 45_000)) || session.error) {
      return null;
    }
    session.lastAccess = Date.now();
    const includeStartHint = !session.startHintServed;
    session.startHintServed = true;
    return { file: playlist, includeStartHint };
  }

  async file(movieId: string, filename: string): Promise<string | null> {
    if (
      !/^(?:index\.m3u8|init\.mp4|seg_\d{5}\.(?:ts|m4s)|sub_\d+\.vtt)$/.test(filename)
    ) {
      return null;
    }
    const session = this.sessions.get(movieId);
    if (!session) return null;
    session.lastAccess = Date.now();
    const target = path.join(session.dir, filename);
    if (filename.endsWith('.vtt')) {
      const streamIndex = Number.parseInt(filename.slice(4, -4), 10);
      if (!session.subtitleStreamIndexes.has(streamIndex)) return null;
      const cacheKey =
        `${session.movieId}-${Math.round(session.sourceMtime)}-` +
        `${session.sourceSize}-${streamIndex}`;
      const cached = path.join(this.subtitleRoot, `${cacheKey}.vtt`);
      const temporary = path.join(this.subtitleRoot, `${cacheKey}.tmp`);
      if (this.subtitleFailures.has(cacheKey)) return null;
      if (!fs.existsSync(cached) && !this.subtitleProcesses.has(cacheKey)) {
        const process = spawn('ffmpeg', subtitleArgs(session.source, temporary, streamIndex), {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        this.subtitleProcesses.set(cacheKey, process);
        process.on('error', () => {
          this.subtitleProcesses.delete(cacheKey);
          this.subtitleFailures.add(cacheKey);
        });
        process.on('close', (code) => {
          this.subtitleProcesses.delete(cacheKey);
          if (!code && fs.existsSync(temporary)) {
            try {
              fs.renameSync(temporary, cached);
            } catch {
              this.subtitleFailures.add(cacheKey);
            }
          } else {
            void fsp.rm(temporary, { force: true });
            this.subtitleFailures.add(cacheKey);
          }
        });
      }
      if (
        !(await waitForFile(cached, 60_000, () => this.subtitleFailures.has(cacheKey)))
      ) {
        return null;
      }
      if (this.sessions.get(movieId) !== session) return null;
      if (session.start <= 0) return cached;
      if (!fs.existsSync(target)) {
        const raw = await fsp.readFile(cached, 'utf8');
        await fsp.writeFile(target, retimeWebVtt(raw, session.start), 'utf8');
      }
      return target;
    }
    const timeout = /\.(?:ts|m4s)$/.test(filename) ? 30_000 : 1_000;
    return (await waitForFile(target, timeout)) ? target : null;
  }

  async subtitle(
    movie: MovieRow,
    source: string,
    streamIndex: number,
    playbackOffset = 0,
    requestedPosition = 0,
  ): Promise<string | null> {
    const valid = parseTracks(movie.subtitle_tracks).some(
      (track) => track.streamIndex === streamIndex,
    );
    if (!valid) return null;

    const safePosition = Math.max(0, Math.min(movie.duration, requestedPosition));
    const bucketStart =
      Math.floor(safePosition / SUBTITLE_BUCKET_SECONDS) * SUBTITLE_BUCKET_SECONDS;
    const extractionStart = Math.max(0, bucketStart - SUBTITLE_LEAD_SECONDS);
    const extractionDuration = Math.max(
      1,
      Math.min(SUBTITLE_WINDOW_SECONDS, movie.duration - extractionStart),
    );
    const cacheKey =
      `${movie.id}-${Math.round(movie.mtime)}-${movie.size}-${streamIndex}-` +
      `${Math.floor(extractionStart)}-${Math.ceil(extractionDuration)}`;
    const cached = path.join(this.subtitleRoot, `${cacheKey}.vtt`);
    const temporary = path.join(this.subtitleRoot, `${cacheKey}.tmp`);
    if (this.subtitleFailures.has(cacheKey)) return null;

    if (!fs.existsSync(cached) && !this.subtitleProcesses.has(cacheKey)) {
      const process = spawn(
        'ffmpeg',
        subtitleArgs(
          source,
          temporary,
          streamIndex,
          extractionStart,
          extractionDuration,
        ),
        { stdio: ['ignore', 'ignore', 'ignore'] },
      );
      this.subtitleProcesses.set(cacheKey, process);
      process.on('error', () => {
        this.subtitleProcesses.delete(cacheKey);
        this.subtitleFailures.add(cacheKey);
      });
      process.on('close', (code) => {
        this.subtitleProcesses.delete(cacheKey);
        if (!code && fs.existsSync(temporary)) {
          try {
            fs.renameSync(temporary, cached);
          } catch {
            this.subtitleFailures.add(cacheKey);
          }
        } else {
          void fsp.rm(temporary, { force: true });
          this.subtitleFailures.add(cacheKey);
        }
      });
    }

    if (!(await waitForFile(cached, 60_000, () => this.subtitleFailures.has(cacheKey)))) {
      return null;
    }

    const offset = extractionStart - Math.max(0, Math.floor(playbackOffset));
    if (Math.abs(offset) < 0.001) return cached;
    const retimed = path.join(this.root, `${cacheKey}-shift-${Math.floor(offset)}.vtt`);
    if (!fs.existsSync(retimed)) {
      const raw = await fsp.readFile(cached, 'utf8');
      await fsp.writeFile(retimed, shiftWebVtt(raw, offset), 'utf8');
    }
    return retimed;
  }

  stop(movieId: string, playbackSessionId?: string): boolean {
    if (playbackSessionId) {
      this.stoppedSessions.set(playbackSessionId, Date.now());
    }
    const session = this.sessions.get(movieId);
    if (!session) return false;
    if (
      playbackSessionId &&
      session.playbackSessionId !== playbackSessionId
    ) {
      return false;
    }
    this.kill(movieId);
    return true;
  }

  close(): void {
    clearInterval(this.sweep);
    for (const id of [...this.sessions.keys()]) this.kill(id);
    for (const process of this.subtitleProcesses.values()) process.kill('SIGKILL');
    this.subtitleProcesses.clear();
    this.stoppedSessions.clear();
    try {
      fs.rmSync(this.root, { recursive: true, force: true });
    } catch {
      // Best effort.
    }
  }
}
