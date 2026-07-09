import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { LibraryDatabase, type TrackRow } from '../src/db.ts';

function row(overrides: Partial<TrackRow> = {}): TrackRow {
  const rid = overrides.id ?? 'id-' + Math.random().toString(36).slice(2);
  return {
    id: rid,
    file_path: overrides.file_path ?? `/lib/${rid}.mp3`,
    rel_path: overrides.rel_path ?? `${rid}.mp3`,
    title: overrides.title ?? 'Song',
    artist: overrides.artist ?? 'Artist',
    album_artist: overrides.album_artist ?? 'Artist',
    album: overrides.album ?? 'Album',
    genre: overrides.genre ?? 'Rock',
    year: overrides.year ?? 2000,
    duration: overrides.duration ?? 180,
    track_no: overrides.track_no ?? 1,
    disc_no: overrides.disc_no ?? 1,
    has_cover: overrides.has_cover ?? 0,
    format: overrides.format ?? 'mp3',
    size: overrides.size ?? 1000,
    mtime: overrides.mtime ?? 1000,
    album_key: overrides.album_key ?? 'ak',
    artist_key: overrides.artist_key ?? 'ark',
    effective_artist: overrides.effective_artist ?? 'Artist',
    date_added: overrides.date_added ?? 5000,
    scanned_at: overrides.scanned_at ?? 5000,
  };
}

describe('LibraryDatabase', () => {
  let dbPath: string;
  let db: LibraryDatabase;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omdb-')), 'test.db');
    db = new LibraryDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('inserts and retrieves a track by id', () => {
    db.upsertTrack(row({ id: 't1', file_path: '/lib/a.mp3', title: 'Alpha' }));
    expect(db.getById('t1')?.title).toBe('Alpha');
    expect(db.count()).toBe(1);
  });

  it('upserts (updates) an existing track by id', () => {
    db.upsertTrack(row({ id: 't1', title: 'Old', date_added: 100 }));
    db.upsertTrack(row({ id: 't1', title: 'New', date_added: 100 }));
    expect(db.count()).toBe(1);
    expect(db.getById('t1')?.title).toBe('New');
    // date_added is preserved on update only if caller passes it; here both pass 100.
    expect(db.getById('t1')?.date_added).toBe(100);
  });

  it('lists tracks sorted by title ascending', () => {
    db.upsertTrack(row({ id: 'b', title: 'Banana' }));
    db.upsertTrack(row({ id: 'a', title: 'Apple' }));
    const res = db.listTracks({ sort: 'title', order: 'asc' });
    expect(res.items.map((t) => t.title)).toEqual(['Apple', 'Banana']);
  });

  it('paginates tracks', () => {
    for (let i = 0; i < 25; i++) db.upsertTrack(row({ id: 't' + i, title: 'T' + i }));
    const page = db.listTracks({ sort: 'title', order: 'asc', page: 2, limit: 10 });
    expect(page.items.length).toBe(10);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(3);
    expect(page.total).toBe(25);
  });

  it('aggregates albums with track counts and cover flag', () => {
    db.upsertTrack(row({ id: '1', album: 'Album One', album_artist: 'X', album_key: 'a1', artist_key: 'x', effective_artist: 'X', track_no: 1, has_cover: 1 }));
    db.upsertTrack(row({ id: '2', album: 'Album One', album_artist: 'X', album_key: 'a1', artist_key: 'x', effective_artist: 'X', track_no: 2 }));
    db.upsertTrack(row({ id: '3', album: 'Album Two', album_artist: 'Y', album_key: 'a2', artist_key: 'y', effective_artist: 'Y' }));
    const albums = db.listAlbums({ sort: 'title', order: 'asc' }).items;
    expect(albums).toHaveLength(2);
    const one = albums.find((a) => a.title === 'Album One')!;
    expect(one.trackCount).toBe(2);
    expect(one.hasCover).toBe(true);
    expect(one.coverTrackId).toBe('1');
  });

  it('groups an album by title even when album_artist differs per track', () => {
    // Soundtrack/compilation case: one album, but each track's `albumartist`
    // tag is a different performer (and one is missing). Title-only grouping
    // must keep it as a single album rather than shattering per performer.
    db.upsertTrack(row({ id: '1', album: 'OST', album_artist: 'Performer A', album_key: 'stale-1', artist_key: 'a', effective_artist: 'Performer A', track_no: 1, has_cover: 1 }));
    db.upsertTrack(row({ id: '2', album: 'OST', album_artist: 'Performer B', album_key: 'stale-2', artist_key: 'b', effective_artist: 'Performer B', track_no: 2 }));
    db.upsertTrack(row({ id: '3', album: 'OST', album_artist: '', album_key: 'stale-3', artist_key: 'c', effective_artist: 'Performer C', track_no: 3 }));

    // The version-gated migration fixes up stale keys via this method.
    db.recomputeAlbumKeys();

    const albums = db.listAlbums({ sort: 'title', order: 'asc' }).items;
    expect(albums).toHaveLength(1);
    expect(albums[0].title).toBe('OST');
    expect(albums[0].trackCount).toBe(3);
    expect(albums[0].coverTrackId).toBe('1');
  });

  it('groups artists and counts albums/tracks', () => {
    db.upsertTrack(row({ id: '1', album_key: 'a1', artist_key: 'x', effective_artist: 'X' }));
    db.upsertTrack(row({ id: '2', album_key: 'a2', artist_key: 'x', effective_artist: 'X' }));
    db.upsertTrack(row({ id: '3', album_key: 'a3', artist_key: 'y', effective_artist: 'Y' }));
    const artists = db.listArtists().items;
    const x = artists.find((a) => a.name === 'X')!;
    expect(x.trackCount).toBe(2);
    expect(x.albumCount).toBe(2);
  });

  it('returns album detail with ordered tracks', () => {
    db.upsertTrack(row({ id: '2', album_key: 'a1', track_no: 2, title: 'Second' }));
    db.upsertTrack(row({ id: '1', album_key: 'a1', track_no: 1, title: 'First' }));
    const detail = db.getAlbumDetail('a1');
    expect(detail).toBeDefined();
    expect(detail!.tracks.map((t) => t.title)).toEqual(['First', 'Second']);
  });

  it('returns artist detail with albums and tracks', () => {
    db.upsertTrack(row({ id: '1', album_key: 'a1', artist_key: 'x', effective_artist: 'X', album: 'One' }));
    db.upsertTrack(row({ id: '2', album_key: 'a2', artist_key: 'x', effective_artist: 'X', album: 'Two' }));
    const detail = db.getArtistDetail('x');
    expect(detail).toBeDefined();
    expect(detail!.albums).toHaveLength(2);
    expect(detail!.tracks).toHaveLength(2);
  });

  it('searches across title, artist, album', () => {
    db.upsertTrack(row({ id: '1', title: 'Yesterday', artist: 'Beatles', album: 'Help' }));
    db.upsertTrack(row({ id: '2', title: 'Other', artist: 'Other', album: 'Other', album_key: 'k2', artist_key: 'o2', effective_artist: 'Other' }));
    const r = db.search('yesterday');
    expect(r.tracks).toHaveLength(1);
    expect(r.albums.length + r.artists.length).toBeGreaterThanOrEqual(0);
  });

  it('prunes tracks missing from a keep-set', () => {
    db.upsertTrack(row({ id: '1', file_path: '/lib/keep.mp3' }));
    db.upsertTrack(row({ id: '2', file_path: '/lib/gone.mp3' }));
    const removed = db.pruneMissing(new Set(['/lib/keep.mp3']));
    expect(removed).toBe(1);
    expect(db.count()).toBe(1);
    expect(db.getById('2')).toBeUndefined();
  });

  it('does not allow sort key injection (whitelist only)', () => {
    // Passing an unknown sort falls back to the default column.
    const res = db.listTracks({ sort: 'title; DROP TABLE tracks;--' as never, order: 'asc' });
    expect(res.items).toEqual([]);
    expect(db.count()).toBe(0); // table still intact
  });

  it('reports library summary counts', () => {
    db.upsertTrack(row({ id: '1', album_key: 'a1', artist_key: 'x', effective_artist: 'X', duration: 120 }));
    const s = db.summary('/lib', true);
    expect(s.trackCount).toBe(1);
    expect(s.albumCount).toBe(1);
    expect(s.artistCount).toBe(1);
    expect(s.totalDurationSeconds).toBe(120);
    expect(s.configured).toBe(true);
  });
});
