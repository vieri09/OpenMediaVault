import { expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.ts';
import { loadConfig } from '../src/config.ts';
import type { AppConfig } from '../src/config.ts';
import { makeTempDir, rmrf, makeMp3, makeMp3WithCover, describeWithFfmpeg } from './helpers.ts';

describeWithFfmpeg('API + scanner integration', () => {
  let libDir: string;
  let dbPath: string;
  let cfg: AppConfig;
   
  let app: any;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    libDir = await makeTempDir('omapi-');
    dbPath = libDir + '-db/test.db';
    // Populate a small library.
    await makeMp3(libDir, 'Aphex Twin/SAW/Xtal.mp3', { title: 'Xtal', artist: 'Aphex Twin', album: 'SAW', track: '1', date: '1992', genre: 'Electronic' });
    await makeMp3(libDir, 'Aphex Twin/SAW/Tha.mp3', { title: 'Tha', artist: 'Aphex Twin', album: 'SAW', track: '2', date: '1992', genre: 'Electronic' });
    await makeMp3WithCover(libDir, 'Cover/Cover Album/Cover Song.mp3', { title: 'Cover Song', artist: 'Cover Artist', album: 'Cover Album' });
    await makeMp3(libDir, 'not-audio.txt.mp3', { title: 'Nope' }); // has .mp3 ext, valid

    // Build a config that points at our temp library.
    const base = loadConfig();
    cfg = { ...base, libraryPath: libDir, databasePath: dbPath };
    const built = createApp({ cfg });
    app = built.app;
    // Run an initial scan so the DB is populated.
    await built.scanner.scan();

    cleanup = async () => {
      built.db.close();
      await rmrf(libDir);
      await rmrf(libDir + '-db');
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/library/summary reports scanned counts', async () => {
    const res = await request(app).get('/api/library/summary');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.trackCount).toBeGreaterThanOrEqual(3);
    expect(res.body.albumCount).toBeGreaterThanOrEqual(2);
    expect(res.body.artistCount).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/tracks returns parsed metadata', async () => {
    const res = await request(app).get('/api/tracks?limit=50&sort=title');
    expect(res.status).toBe(200);
    const xtal = res.body.items.find((t: { title: string }) => t.title === 'Xtal');
    expect(xtal).toBeDefined();
    expect(xtal.artist).toBe('Aphex Twin');
    expect(xtal.album).toBe('SAW');
    expect(xtal.year).toBe(1992);
    expect(xtal.trackNumber).toBe(1);
    expect(xtal.duration).toBeGreaterThan(0);
  });

  it('GET /api/albums aggregates and exposes cover track', async () => {
    const res = await request(app).get('/api/albums');
    const cover = res.body.items.find((a: { title: string }) => a.title === 'Cover Album');
    expect(cover.hasCover).toBe(true);
    expect(cover.coverTrackId).toBeTruthy();
  });

  it('GET /api/albums/:id returns tracks in order', async () => {
    const albums = (await request(app).get('/api/albums')).body.items;
    const saw = albums.find((a: { title: string }) => a.title === 'SAW');
    const res = await request(app).get(`/api/albums/${saw.id}`);
    expect(res.status).toBe(200);
    expect(res.body.tracks.map((t: { title: string }) => t.title)).toEqual(['Xtal', 'Tha']);
  });

  it('GET /api/genres lists genres', async () => {
    const res = await request(app).get('/api/genres');
    const names = res.body.map((g: { name: string }) => g.name);
    expect(names).toContain('Electronic');
  });

  it('GET /api/search finds by query', async () => {
    const res = await request(app).get('/api/search?q=aphex');
    expect(res.body.tracks.length).toBeGreaterThanOrEqual(2);
    expect(res.body.artists.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/stream/:id serves a 206 partial response with Content-Range', async () => {
    const tracks = (await request(app).get('/api/tracks?limit=1')).body.items;
    const id = tracks[0].id;
    const res = await request(app)
      .get(`/api/stream/${id}`)
      .set('Range', 'bytes=0-255');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-255\/\d+$/);
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('GET /api/stream/:id serves 200 without a range header', async () => {
    const tracks = (await request(app).get('/api/tracks?limit=1')).body.items;
    const res = await request(app).get(`/api/stream/${tracks[0].id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBeDefined();
  });

  it('GET /api/stream with a bogus id returns 404', async () => {
    const res = await request(app).get('/api/stream/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('GET /api/cover/:id returns image bytes for a track with art', async () => {
    const tracks = (await request(app).get('/api/tracks?search=Cover%20Song')).body.items;
    const res = await request(app).get(`/api/cover/${tracks[0].id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\//);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /api/cover/:id returns 404 for a track without art', async () => {
    const tracks = (await request(app).get('/api/tracks?search=Xtal')).body.items;
    const res = await request(app).get(`/api/cover/${tracks[0].id}`);
    expect(res.status).toBe(404);
  });

  it('POST /api/rescan is idempotent and reports scan status', async () => {
    const res = await request(app).post('/api/rescan');
    expect([202, 409]).toContain(res.status);
    // Poll scan status until finished (skipped everything the second time).
    for (let i = 0; i < 40; i++) {
      const status = (await request(app).get('/api/scan/status')).body;
      if (!status.scanning && status.lastResult) {
        // Second scan: everything skipped (no changes).
        expect(status.lastResult.skipped).toBeGreaterThan(0);
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('Scan did not finish in time');
  });

  it('removes tracks that disappear from disk on rescan', async () => {
    // Add then delete a file and rescan.
    const before = (await request(app).get('/api/library/summary')).body.trackCount;
    const file = libDir + '/Aphex Twin/SAW/Tha.mp3';
    await rmrf(file);
    // trigger rescan and wait
    await request(app).post('/api/rescan');
    for (let i = 0; i < 40; i++) {
      const status = (await request(app).get('/api/scan/status')).body;
      if (!status.scanning) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    const after = (await request(app).get('/api/library/summary')).body.trackCount;
    expect(after).toBe(before - 1);
  });
});
