import { describe, expect, it } from 'vitest';
import { resolveWithin, isWithin } from '../src/paths.ts';
import { parseRange } from '../src/stream.ts';

describe('resolveWithin', () => {
  const root = '/var/music';

  it('resolves a simple relative path inside the root', () => {
    expect(resolveWithin(root, 'song.mp3')).toBe('/var/music/song.mp3');
  });

  it('resolves nested relative paths', () => {
    expect(resolveWithin(root, 'Artist/Album/song.flac')).toBe('/var/music/Artist/Album/song.flac');
  });

  it('rejects parent-directory traversal', () => {
    expect(() => resolveWithin(root, '../etc/passwd')).toThrow();
    expect(() => resolveWithin(root, 'foo/../../etc/passwd')).toThrow();
  });

  it('rejects absolute paths', () => {
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow();
    expect(() => resolveWithin(root, '/var/music/../etc/passwd')).toThrow();
  });

  it('accepts the root itself', () => {
    expect(resolveWithin(root, '.')).toBe('/var/music');
  });

  it('rejects traversal to a sibling directory with a similar name', () => {
    // "/var/music-evil" starts with "/var/music" but is outside; the
    // separator-based check must reject it.
    expect(() => resolveWithin(root, '../music-evil/secret')).toThrow();
  });
});

describe('isWithin', () => {
  const root = '/var/music';
  it('true for nested', () => {
    expect(isWithin(root, '/var/music/a/b.mp3')).toBe(true);
  });
  it('true for root itself', () => {
    expect(isWithin(root, '/var/music')).toBe(true);
  });
  it('false for sibling directory with similar name', () => {
    expect(isWithin(root, '/var/music-evil/x')).toBe(false);
  });
  it('false for parent', () => {
    expect(isWithin(root, '/var')).toBe(false);
  });
});

describe('parseRange (HTTP Range header)', () => {
  it('returns null when no range header', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
  });
  it('parses a normal byte range', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499, total: 1000 });
  });
  it('parses an open-ended range', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999, total: 1000 });
  });
  it('parses a suffix range (last N bytes)', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999, total: 1000 });
  });
  it('clamps end to size - 1', () => {
    expect(parseRange('bytes=500-9999', 1000)).toEqual({ start: 500, end: 999, total: 1000 });
  });
  it('rejects start >= size', () => {
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=2000-3000', 1000)).toBeNull();
  });
  it('rejects malformed range', () => {
    expect(parseRange('items=0-1', 1000)).toBeNull();
    expect(parseRange('bytes=abc', 1000)).toBeNull();
  });
});
