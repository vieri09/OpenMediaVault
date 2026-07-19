import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { trackId } from './keys.ts';
import type { MovieRow } from './video-db.ts';
import type { MoviePlaybackMode } from './video-types.ts';

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  tags?: {
    language?: string;
    title?: string;
  };
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
  };
}

export const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mkv', 'avi']);
export const VIDEO_PROBE_VERSION = '2';
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'subviewer',
  'text',
]);

let toolAvailability: boolean | undefined;

export function ffmpegAvailable(): boolean {
  if (toolAvailability === undefined) {
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    const ffprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
    toolAvailability = ffmpeg.status === 0 && ffprobe.status === 0;
  }
  return toolAvailability;
}

export function moviePlaybackMode(
  format: string,
  videoCodec: string,
  audioCodec: string,
  videoCopyable = true,
): MoviePlaybackMode {
  const directContainer = format === 'mp4' || format === 'm4v';
  const directVideo = videoCodec === 'h264' && videoCopyable;
  const directAudio = audioCodec === '' || audioCodec === 'aac' || audioCodec === 'mp3';
  return directContainer && directVideo && directAudio ? 'direct' : 'hls';
}

function movieName(relPath: string): { title: string; folder: string; year: number | null } {
  const ext = path.extname(relPath);
  const raw = path.basename(relPath, ext);
  const yearMatch = raw.match(/(?:^|[\s.[(])(19\d{2}|20\d{2})(?=$|[\s.\])])/);
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
  const title = raw
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parent = path.dirname(relPath);
  const folder = parent === '.' ? '' : path.basename(parent);
  return { title: title || raw, folder, year };
}

function runProbe(absPath: string): Promise<ProbeOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-probesize',
        '8M',
        '-analyzeduration',
        '8M',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        absPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => proc.kill('SIGKILL'), 30_000);
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-1_000_000);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start ffprobe: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`ffprobe failed${stderr ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ProbeOutput);
      } catch {
        reject(new Error('ffprobe returned invalid metadata.'));
      }
    });
  });
}

export async function probeMovie(
  absPath: string,
  relPath: string,
  stat: { size: number; mtimeMs: number },
): Promise<MovieRow> {
  const metadata = await runProbe(absPath);
  const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const audioStreams = metadata.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];
  const audio = audioStreams[0];
  const subtitleStreams =
    metadata.streams?.filter(
      (stream) =>
        stream.codec_type === 'subtitle' &&
        Boolean(stream.codec_name && TEXT_SUBTITLE_CODECS.has(stream.codec_name)),
    ) ?? [];
  if (!video?.codec_name) throw new Error('No video stream found.');

  const format = path.extname(absPath).slice(1).toLowerCase();
  const videoCodec = video.codec_name.toLowerCase();
  const pixelFormat = video.pix_fmt?.toLowerCase() ?? '';
  const profile = video.profile?.toLowerCase() ?? '';
  const videoCopyable =
    videoCodec === 'h264' &&
    (pixelFormat === 'yuv420p' || pixelFormat === 'yuvj420p') &&
    !profile.includes('10') &&
    !profile.includes('4:2:2') &&
    !profile.includes('4:4:4');
  const audioCodec = audio?.codec_name?.toLowerCase() ?? '';
  const duration = Math.max(0, Number.parseFloat(metadata.format?.duration ?? '0') || 0);
  const names = movieName(relPath);
  const tracks = (streams: ProbeStream[]) =>
    streams
      .filter((stream): stream is ProbeStream & { index: number; codec_name: string } =>
        Number.isInteger(stream.index) && Boolean(stream.codec_name),
      )
      .map((stream) => ({
        streamIndex: stream.index,
        codec: stream.codec_name.toLowerCase(),
        language: stream.tags?.language ?? '',
        title: stream.tags?.title ?? '',
      }));

  return {
    id: trackId(`movie:${relPath}`),
    file_path: absPath,
    rel_path: relPath,
    title: names.title,
    folder: names.folder,
    year: names.year,
    format,
    duration: Math.round(duration * 1000) / 1000,
    video_codec: videoCodec,
    video_copyable: videoCopyable ? 1 : 0,
    audio_codec: audioCodec,
    audio_tracks: JSON.stringify(tracks(audioStreams)),
    subtitle_tracks: JSON.stringify(tracks(subtitleStreams)),
    width: Math.max(0, video.width ?? 0),
    height: Math.max(0, video.height ?? 0),
    playback_mode: moviePlaybackMode(format, videoCodec, audioCodec, videoCopyable),
    size: stat.size,
    mtime: stat.mtimeMs,
    date_added: 0,
    scanned_at: 0,
  };
}
