import { describe, expect, it, afterEach } from 'vitest';
import { loadConfig, AUDIO_EXTENSIONS, allAudioExtensions } from '../src/config.ts';
import type { AppConfig } from '../src/config.ts';

function withEnv(env: Record<string, string | undefined>): typeof process.env {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return saved;
}

function restore(saved: typeof process.env): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
}

describe('loadConfig', () => {
  let saved: typeof process.env;
  afterEach(() => restore(saved));

  it('uses defaults when env vars are absent', () => {
    saved = withEnv({
      MUSIC_LIBRARY_PATH: undefined,
      MOVIE_LIBRARY_PATH: undefined,
      APP_PORT: undefined,
      APP_HOST: undefined,
      DATABASE_PATH: undefined,
      LOG_LEVEL: undefined,
      EXTRA_AUDIO_EXTENSIONS: undefined,
    });
    const cfg = loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.movieLibraryPath).toBeNull();
    expect(cfg.logLevel).toBe('info');
    expect(cfg.databasePath.endsWith('data/library.db')).toBe(true);
  });

  it('parses a custom port and database path', () => {
    saved = withEnv({
      APP_PORT: '4242',
      APP_HOST: '0.0.0.0',
      DATABASE_PATH: '/tmp/x.db',
      MOVIE_LIBRARY_PATH: '/tmp/movies',
    });
    const cfg = loadConfig();
    expect(cfg.port).toBe(4242);
    expect(cfg.databasePath).toBe('/tmp/x.db');
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.movieLibraryPath).toBe('/tmp/movies');
  });

  it('rejects an invalid port', () => {
    saved = withEnv({ APP_PORT: 'not-a-port' });
    expect(() => loadConfig()).toThrow(/APP_PORT/);
  });

  it('rejects port out of range', () => {
    saved = withEnv({ APP_PORT: '99999' });
    expect(() => loadConfig()).toThrow(/APP_PORT/);
  });

  it('rejects an invalid host', () => {
    saved = withEnv({ APP_HOST: 'http://localhost:3000' });
    expect(() => loadConfig()).toThrow(/APP_HOST/);
  });

  it('rejects an invalid log level', () => {
    saved = withEnv({ LOG_LEVEL: 'verbose' });
    expect(() => loadConfig()).toThrow(/LOG_LEVEL/);
  });

  it('parses extra audio extensions (strips dots, lowercases)', () => {
    saved = withEnv({ EXTRA_AUDIO_EXTENSIONS: '.AIF, m4b, caf' });
    const cfg: AppConfig = loadConfig();
    expect(cfg.extraExtensions.has('aif')).toBe(true);
    expect(cfg.extraExtensions.has('m4b')).toBe(true);
    expect(cfg.extraExtensions.has('caf')).toBe(true);
    const merged = allAudioExtensions(cfg);
    expect(merged.has('mp3')).toBe(true); // built-ins preserved
    expect(merged.has('caf')).toBe(true);
  });
});

describe('AUDIO_EXTENSIONS', () => {
  it('includes the required common formats', () => {
    for (const ext of ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus', 'aac']) {
      expect(AUDIO_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});
