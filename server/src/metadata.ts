import { parseFile, type IAudioMetadata } from 'music-metadata';
import path from 'node:path';
import type { TrackRow } from './db.ts';
import { trackId, albumKey, artistKey } from './keys.ts';

/** Pick the first string from a metadata field that may be string | string[]. */
function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function effectiveArtist(trackArtist: string, albumArtist: string): string {
  return (albumArtist || trackArtist || '').trim();
}

export interface ParsedTrack {
  row: TrackRow;
}

/**
 * Parse a single audio file into a normalized TrackRow.
 * Throws if the file cannot be read or parsed — callers record it as a scan error.
 */
export async function parseTrack(absPath: string, relPath: string): Promise<ParsedTrack> {
  const meta: IAudioMetadata = await parseFile(absPath, { duration: true });
  const common = meta.common;
  const format = path.extname(absPath).slice(1).toLowerCase();

  const title = (common.title ?? '').trim() || path.basename(absPath, path.extname(absPath));
  const artist = firstString(common.artist).trim();
  const albumArtistRaw = firstString(common.albumartist).trim();
  const album = (common.album ?? '').trim();
  const genre = (common.genre ? common.genre[0] : '').trim();
  const year = num(common.year ?? common.originaldate);
  const duration = Math.max(0, meta.format.duration ?? 0);
  const trackNo = num(common.track?.no);
  const discNo = num(common.disk?.no);
  const effArtist = effectiveArtist(artist, albumArtistRaw);

  const stat = await safeStat(absPath);

  const row: TrackRow = {
    id: trackId(relPath),
    file_path: absPath,
    rel_path: relPath,
    title,
    artist,
    album_artist: albumArtistRaw,
    album,
    genre,
    year,
    duration: Math.round(duration * 1000) / 1000,
    track_no: trackNo,
    disc_no: discNo,
    has_cover: meta.common.picture && meta.common.picture.length > 0 ? 1 : 0,
    format,
    size: stat?.size ?? 0,
    mtime: stat?.mtimeMs ?? 0,
    album_key: albumKey(album),
    artist_key: artistKey(effArtist),
    effective_artist: effArtist,
    date_added: 0, // filled by scanner on first insert
    scanned_at: 0, // filled by scanner
  };
  return { row };
}

async function safeStat(p: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const fs = await import('node:fs/promises');
    const s = await fs.stat(p);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Read embedded cover art for a track. Returns { data, mime } or null when there
 * is no picture. The first picture is used.
 */
export async function readCover(absPath: string): Promise<{ data: Buffer; mime: string } | null> {
  const meta = await parseFile(absPath, { skipCovers: false });
  const pic = meta.common.picture?.[0];
  if (!pic) return null;
  return { data: Buffer.from(pic.data), mime: pic.format || 'image/jpeg' };
}
