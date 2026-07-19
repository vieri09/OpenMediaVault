import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { createApp } from '../src/index.ts';
import { loadConfig } from '../src/config.ts';
import { moviePlaybackMode } from '../src/video-probe.ts';
import { describeWithFfmpeg, makeTempDir, makeVideo, rmrf } from './helpers.ts';

describe('movie playback selection', () => {
  it('direct-plays compatible H.264 MP4', () => {
    expect(moviePlaybackMode('mp4', 'h264', 'aac')).toBe('direct');
  });

  it('routes HEVC, MKV and incompatible audio through HLS', () => {
    expect(moviePlaybackMode('mp4', 'hevc', 'aac')).toBe('hls');
    expect(moviePlaybackMode('mkv', 'h264', 'aac')).toBe('hls');
    expect(moviePlaybackMode('mp4', 'h264', 'ac3')).toBe('hls');
    expect(moviePlaybackMode('mp4', 'h264', 'aac', false)).toBe('hls');
  });
});

describeWithFfmpeg('movie API integration', () => {
  let movieDir: string;
  let musicDir: string;
  let dbDir: string;
  let built: ReturnType<typeof createApp>;

  beforeAll(async () => {
    movieDir = await makeTempDir('ommovies-');
    musicDir = await makeTempDir('ommusic-');
    dbDir = await makeTempDir('omvideo-db-');
    await makeVideo(movieDir, 'Direct/Direct Movie (2024).mp4', { duration: 70 });
    await makeVideo(movieDir, 'Archive/Container Movie.mkv', {
      duration: 14,
      subtitleTracks: 9,
    });
    await makeVideo(movieDir, 'Legacy/Legacy Clip.avi', {
      videoCodec: 'mpeg4',
      duration: 3,
    });
    await makeVideo(movieDir, 'Series/Season 01/Pilot.mp4', { duration: 2 });

    const cfg = {
      ...loadConfig(),
      libraryPath: musicDir,
      movieLibraryPath: movieDir,
      databasePath: path.join(dbDir, 'library.db'),
    };
    built = createApp({ cfg });
    await built.videoScanner.scan();
  });

  afterAll(async () => {
    built.videoTranscoder.close();
    built.videoDb.close();
    built.db.close();
    await rmrf(movieDir);
    await rmrf(musicDir);
    await rmrf(dbDir);
  });

  it('indexes movie metadata without exposing file paths', async () => {
    const response = await request(built.app).get('/api/movies?sort=title&order=asc');
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(4);
    expect(response.body.items[0].title).toContain('Container Movie');
    expect(response.body.items[1].year).toBe(2024);
    expect(response.body.items[1].playbackMode).toBe('direct');
    expect(response.body.items[0].playbackMode).toBe('hls');
    expect(response.body.items[2].format).toBe('avi');
    expect(response.body.items[2].playbackMode).toBe('hls');
    expect(response.body.items[0]).not.toHaveProperty('file_path');
    expect(response.body.items[0]).not.toHaveProperty('rel_path');
  });

  it('sorts the default flat movie search alphabetically', async () => {
    const response = await request(built.app).get('/api/movies');
    expect(response.body.items.map((movie: { title: string }) => movie.title)).toEqual([
      'Container Movie',
      'Direct Movie (2024)',
      'Legacy Clip',
      'Pilot',
    ]);
  });

  it('reports scan progress and playback summary', async () => {
    const status = await request(built.app).get('/api/movies/scan/status');
    expect(status.body.processed).toBe(status.body.total);
    const summary = await request(built.app).get('/api/movies/summary');
    expect(summary.body.configured).toBe(true);
    expect(summary.body.movieCount).toBe(4);
    expect(summary.body.directPlayCount).toBe(2);
    expect(summary.body.transcodeCount).toBe(2);
  });

  it('browses the existing folder structure with alphabetical names and opaque ids', async () => {
    const root = await request(built.app).get('/api/movies/folders');
    expect(root.status).toBe(200);
    expect(root.body.current).toEqual({ id: 'root', name: 'Movies' });
    expect(root.body.folders.map((folder: { name: string }) => folder.name)).toEqual([
      'Archive',
      'Direct',
      'Legacy',
      'Series',
    ]);
    expect(root.body.folders[0]).not.toHaveProperty('path');
    expect(root.body.folders.find((folder: { name: string }) => folder.name === 'Series'))
      .toMatchObject({ movieCount: 1, subfolderCount: 1 });

    const archive = await request(built.app).get(
      `/api/movies/folders/${root.body.folders[0].id}`,
    );
    expect(archive.status).toBe(200);
    expect(archive.body.current.name).toBe('Archive');
    expect(archive.body.movies[0].title).toContain('Container Movie');
    expect(archive.body.movies[0]).not.toHaveProperty('rel_path');

    const seriesFolder = root.body.folders.find(
      (folder: { name: string }) => folder.name === 'Series',
    );
    const series = await request(built.app).get(`/api/movies/folders/${seriesFolder.id}`);
    expect(series.body.folders[0]).toMatchObject({
      name: 'Season 01',
      movieCount: 1,
      subfolderCount: 0,
    });
  });

  it('range-streams direct MP4 playback', async () => {
    const movies = (await request(built.app).get('/api/movies?search=Direct')).body.items;
    const response = await request(built.app)
      .get(`/api/movies/${movies[0].id}/stream`)
      .set('Range', 'bytes=0-255');
    expect(response.status).toBe(206);
    expect(response.headers['content-type']).toMatch(/^video\/mp4/);
    expect(response.headers['content-range']).toMatch(/^bytes 0-255\/\d+$/);
  });

  it('generates and caches a landscape thumbnail on demand', async () => {
    const movies = (await request(built.app).get('/api/movies?search=Direct')).body.items;
    const first = await request(built.app).get(`/api/movies/${movies[0].id}/thumbnail`);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(first.body.length).toBeGreaterThan(100);
    const second = await request(built.app).get(`/api/movies/${movies[0].id}/thumbnail`);
    expect(second.status).toBe(200);
    expect(second.body.length).toBe(first.body.length);
  });

  it('creates HLS for an H.264 MKV without exposing the source path', async () => {
    const movies = (await request(built.app).get('/api/movies?search=Container')).body.items;
    const response = await request(built.app).get(`/api/movies/${movies[0].id}/hls/index.m3u8`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/mpegurl/);
    expect(response.text).toContain('#EXTM3U');
    expect(response.text).toContain('#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
    expect(response.text).toContain('#EXT-X-TARGETDURATION:2');
    expect(response.text).toContain('#EXT-X-INDEPENDENT-SEGMENTS');
    expect(response.text).toContain('#EXT-X-MAP:URI="init.mp4"');
    const segments = [...response.text.matchAll(/#EXTINF:([\d.]+)/g)];
    const bufferedSeconds = segments
      .reduce((total, match) => total + Number.parseFloat(match[1]), 0);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(bufferedSeconds).toBeGreaterThanOrEqual(5);
    expect(response.text).not.toContain(movieDir);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.etag).toBeUndefined();

    const init = await request(built.app)
      .get(`/api/movies/${movies[0].id}/hls/init.mp4`);
    expect(init.status).toBe(200);
    expect(init.headers['content-type']).toMatch(/^video\/mp4/);

    const segmentFiles = [...response.text.matchAll(/^(seg_\d{5}\.m4s)$/gm)]
      .map((match) => match[1]);
    expect(segmentFiles.length).toBeGreaterThanOrEqual(2);
    for (const segmentFile of segmentFiles.slice(0, 3)) {
      const segment = await request(built.app)
        .get(`/api/movies/${movies[0].id}/hls/${segmentFile}`);
      expect(segment.status).toBe(200);
      expect(segment.headers['content-type']).toMatch(/^video\/mp4/);
      expect(segment.headers['cache-control']).toContain('immutable');
      expect(segment.body.length).toBeGreaterThan(100);
    }
  }, 50_000);

  it('does not let a stale player cleanup stop a newer HLS session', async () => {
    const movie = (await request(built.app).get('/api/movies?search=Container')).body.items[0];
    const staleSession = 'stale-player-session';
    const activeSession = 'active-player-session';

    const earlyCleanup = await request(built.app)
      .delete(`/api/movies/${movie.id}/hls?session=${staleSession}`);
    expect(earlyCleanup.body).toMatchObject({ ok: true, stopped: false });

    const staleRequest = await request(built.app)
      .get(`/api/movies/${movie.id}/hls/index.m3u8?session=${staleSession}`);
    expect(staleRequest.status).toBe(502);

    const activeRequest = await request(built.app)
      .get(`/api/movies/${movie.id}/hls/index.m3u8?session=${activeSession}`);
    expect(activeRequest.status).toBe(200);

    const lateCleanup = await request(built.app)
      .delete(`/api/movies/${movie.id}/hls?session=${staleSession}`);
    expect(lateCleanup.body).toMatchObject({ ok: true, stopped: false });

    const stillActive = await request(built.app)
      .get(`/api/movies/${movie.id}/hls/index.m3u8?session=${activeSession}`);
    expect(stillActive.status).toBe(200);
    expect(stillActive.text).toContain('#EXTM3U');
    expect(stillActive.text).not.toContain('#EXT-X-START:');
  }, 50_000);

  it('serves any detected subtitle stream, including tracks beyond the first eight', async () => {
    const movie = (await request(built.app).get('/api/movies?search=Container')).body.items[0];
    expect(movie.subtitleTracks).toHaveLength(9);
    const lastTrack = movie.subtitleTracks[8];
    const response = await request(built.app).get(
      `/api/movies/${movie.id}/subtitles/${lastTrack.streamIndex}.vtt`,
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/vtt/);
    expect(response.text).toContain('WEBVTT');
    expect(response.text).toContain('Fixture subtitle text');
  }, 20_000);

  it('stores continue-watching progress and clears completed playback', async () => {
    const movie = (await request(built.app).get('/api/movies?search=Direct')).body.items[0];
    const saved = await request(built.app)
      .put(`/api/movies/${movie.id}/progress`)
      .send({ position: 35, duration: 70 });
    expect(saved.status).toBe(200);
    const continuing = await request(built.app).get('/api/movies/continue');
    expect(continuing.body[0].id).toBe(movie.id);
    expect(continuing.body[0].resumePosition).toBe(35);

    await request(built.app)
      .put(`/api/movies/${movie.id}/progress`)
      .send({ position: 68, duration: 70 });
    const after = await request(built.app).get('/api/movies/continue');
    expect(after.body).toEqual([]);
  });

  it('rejects malformed progress values', async () => {
    const movie = (await request(built.app).get('/api/movies?limit=1')).body.items[0];
    const response = await request(built.app)
      .put(`/api/movies/${movie.id}/progress`)
      .send({ position: 'outside', duration: -1 });
    expect(response.status).toBe(400);
  });
});
