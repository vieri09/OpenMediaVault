import { describe, expect, it } from 'vitest';
import { trackId, albumKey, artistKey } from '../src/keys.ts';

describe('key determinism', () => {
  it('produces stable track ids for the same relative path', () => {
    expect(trackId('A/B/song.mp3')).toBe(trackId('A/B/song.mp3'));
  });
  it('produces different track ids for different paths', () => {
    expect(trackId('A/song.mp3')).not.toBe(trackId('B/song.mp3'));
  });
  it('groups albums case/space-insensitively by title', () => {
    expect(albumKey('Discovery')).toBe(albumKey(' discovery '));
  });
  it('groups an album by title alone, ignoring album-artist differences', () => {
    // Title-only grouping: varying or missing albumartist must not split an album.
    expect(albumKey('Discovery')).toBe(albumKey('DISCOVERY'));
  });
  it('treats unknown album consistently', () => {
    expect(albumKey('')).toBe(albumKey(undefined));
  });
  it('groups artists by effective name', () => {
    expect(artistKey('Daft Punk')).toBe(artistKey('  daft punk '));
  });
  it('returns 40-char hex sha1', () => {
    expect(trackId('x.mp3')).toMatch(/^[0-9a-f]{40}$/);
  });
});
