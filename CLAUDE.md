# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start server + client concurrently (dev mode)
npm run build        # Build client (tsc + vite) then typecheck server
npm start            # Production: serve built SPA + API from single port
npm run typecheck    # TypeScript check both workspaces
npm run lint         # ESLint both workspaces
npm test             # Backend test suite (Vitest, 30s timeout)
npm run test:watch -w server   # Backend tests in watch mode
npm run dev:server   # Server only (tsx watch)
npm run dev:client   # Client only (Vite dev server)
```

Tests live in `server/test/`. Scanner/API integration tests generate tiny MP3s with `ffmpeg` — those tests auto-skip if `ffmpeg` is not on `$PATH` (pure-logic tests still run). Vitest pool: `forks`. Config: `server/vitest.config.ts`.

To run a single test file: `npx vitest run server/test/paths.test.ts` (from repo root). To run a specific test pattern: `npx vitest run -t "pattern" server/test/db.test.ts`.

## Architecture

**Monorepo** (npm workspaces) — two packages under `server/` and `client/`. All scripts run from the repo root.

### Server (`server/`)

Express + TypeScript + `better-sqlite3`. Entry: `server/src/index.ts` (`createApp()` exported for test injection). Key modules:

| File | Responsibility |
|---|---|
| `config.ts` | Reads `.env`, resolves paths relative to repo root (not cwd), validates. |
| `db.ts` | `LibraryDatabase` class — SQLite schema, prepared statements, whitelisted sort keys, pagination, search. |
| `scanner.ts` | Recursive walk with bounded concurrency (8). Incremental via mtime+size check. Auto-prunes deleted files. |
| `metadata.ts` | `music-metadata` parsing → normalized `TrackRow`. |
| `paths.ts` | `resolveWithin()` — the anti-traversal chokepoint. Every stream/cover request goes through this. |
| `keys.ts` | Deterministic SHA-1 public IDs for tracks, albums, artists (stable across rescans). |
| `routes.ts` | All `/api/*` music endpoints. `buildRouter(svc)` takes `{cfg, db, scanner}` for DI. |
| `stream.ts` | HTTP Range-aware audio streaming. |
| `errors.ts` | `HttpError` class + factory functions (`notFound`, `badRequest`, `forbidden`, `conflict`). |
| `types.ts` | Shared domain types: `Track`, `Album`, `Artist`, `Genre`, `PageResult<T>`, `ScanStatus`, etc. |
| `logger.ts` | Leveled logging (`debug`, `info`, `warn`, `error`). |
| `video-db.ts` | `VideoDatabase` class — SQLite schema for movies with resume progress. |
| `video-scanner.ts` | Movie library scanner (MP4, M4V, MKV, AVI). |
| `video-probe.ts` | FFmpeg/ffprobe wrapper for codec detection and stream info. |
| `video-transcode.ts` | FFmpeg HLS transcoding for non-browser-compatible formats. |
| `video-stream.ts` | HTTP Range-aware direct MP4 streaming for compatible files. |
| `video-thumbnail.ts` | On-demand thumbnail generation from movie files. |
| `video-routes.ts` | `/api/movies/*` endpoints. |
| `video-types.ts` | Movie domain types (`MovieRow`, `MovieDetail`, `MovieSortKey`, etc.). |
| `index.ts` | Express app factory + bootstrap. Error middleware. Production SPA serving. |

**DI pattern:** `createApp(deps?)` accepts optional overrides for `cfg`, `db`, `scanner`, `videoDb`, `videoScanner`, `videoTranscoder`. Tests inject stubbed configs and temp databases. Route builders (`buildRouter`, `buildVideoRouter`) take a services object — the same pattern.

**Error handling:** Route handlers throw `HttpError` (e.g. `throw notFound('msg', 'CODE')`). Async handlers are wrapped with `wrap()` (from `routes.ts`) which forwards rejections to Express error middleware. The centralized error handler in `index.ts` maps `HttpError` → structured JSON `{error, code}`, `SyntaxError` → 400, everything else → 500.

**Security invariants:**
- Clients reference **track IDs only** (SHA-1 of relative path), never filesystem paths.
- `resolveWithin()` rejects absolute paths and `..` traversal outside `MUSIC_LIBRARY_PATH`.
- SQL sort keys are whitelisted (`ALBUM_SORT`, `TRACK_SORT` maps), never interpolated from query params.
- Strict CSP headers (`default-src 'self'`; no `script-src` exceptions; `frame-ancestors 'none'`).
- Cross-site POST requests are rejected via `Sec-Fetch-Site` check before any filesystem work.
- Loopback-only by default; requesting from a non-loopback `Host` header when bound to loopback returns 421.

**Album key migration:** Album keys are computed from title only via `albumKey()` in `keys.ts`. On every DB open, `migrate()` checks `album_key_version` meta key and recomputes all album keys if the version doesn't match — this is idempotent and lets the grouping formula change without a full rescan.

### Client (`client/`)

React 18 + Vite + TypeScript. React Router v6 with two separate app layouts mounted at different paths.

**Dual-app routing** (`main.tsx`):
- `/music/*` routes → `App.tsx` (MusicApp layout with sidebar nav)
- `/movie/*` routes → `MovieApp.tsx` (MovieApp layout)
- `/movie/watch/:id` → `VideoPlayer.tsx` (standalone, no app chrome)
- Legacy redirects (`/albums`, `/artists`, etc.) → `/music/*`
- All page components are lazy-loaded via `React.lazy()` + `Suspense`
- Root `/` redirects to `/music`

**State management (all zustand, persisted to localStorage):**
- `stores/player.ts` — Queue state machine: `queue` (stable order) + `order` (playback permutation). Shuffle pins current track at front via Fisher-Yates. Repeat modes: off / all / one.
- `stores/library.ts` — Favorites set + recently played list (capped at 100).
- `stores/ui.ts` — UI flags (queue panel, command palette visibility).

**Data fetching:** SWR with a custom `fetcher` in `main.tsx`. Typed API client in `api.ts` (`getJSON<T>()` helper). Stream/cover URLs returned as strings for direct `<audio>`/`<img>` use.

**Music pages:** Library, Albums, AlbumDetail, Artists, ArtistDetail, Genres, Songs, Search, NowPlaying.

**Movie pages:** Movies, MovieDetail, ContinueWatching, VideoPlayer.

**Components:** Player (bottom bar + audio element), QueuePanel (slide-out), CommandPalette (⌘K), TrackList, Grids, Cover, RescanButton, MovieCard, MovieScanButton, MediaSwitcher, LegacyRedirect, common (shared UI primitives like `Spinner`, `ErrorBlock`, `EmptyState`).

**Hooks:** `useKeyboard` (global hotkeys matching Monochrome scheme), `useMediaSession` (OS media controls).

**Lib:** `format.ts` — duration formatting, file size formatting.

**Video playback:** `hls.js` for HLS streaming of transcoded movies. Native `<video>` for direct MP4 playback. `fuse.js` powers client-side fuzzy search in the command palette.

### API

All endpoints at `/api/*`. Key patterns: paginated lists with whitelisted sort keys, stable SHA-1 IDs, Range-aware streaming (`GET /api/stream/:id`), embedded cover art (`GET /api/cover/:id`). Rescan is async: `POST /api/rescan` → 202, poll `GET /api/scan/status`.

Music endpoints:

| Method & path | Description |
|---|---|
| `GET /api/health` | Liveness probe |
| `GET /api/library/summary` | Counts + config status |
| `GET /api/tracks` | List tracks (`?sort`, `order`, `page`, `limit`, `search`, `genre`) |
| `GET /api/albums` | List albums (`?sort`, `order`, `page`, `limit`, `search`) |
| `GET /api/albums/recent` | Recently added albums |
| `GET /api/albums/:id` | Album detail with ordered tracks |
| `GET /api/artists` | List artists |
| `GET /api/artists/:id` | Artist detail with albums + tracks |
| `GET /api/genres` | All genres with counts |
| `GET /api/search?q=` | Search tracks/albums/artists |
| `GET /api/stream/:id` | Stream audio (HTTP Range aware) |
| `GET /api/cover/:id` | Embedded cover art |
| `POST /api/rescan` | Trigger music rescan (async) |
| `GET /api/scan/status` | Scan progress / last result |

Movie endpoints:

| Method & path | Description |
|---|---|
| `GET /api/movies/summary` | Movie counts + ffmpeg availability |
| `GET /api/movies` | List movies (`?sort`, `order`, `page`, `limit`, `search`) |
| `GET /api/movies/continue` | Movies with saved progress |
| `GET /api/movies/folders` | Root folder listing |
| `GET /api/movies/folders/:folderId` | Browse a folder |
| `GET /api/movies/:id` | Movie detail with streams + audio/subtitle tracks |
| `GET /api/movies/:id/stream` | Direct MP4 streaming (Range aware) |
| `GET /api/movies/:id/thumbnail` | Generated movie thumbnail |
| `GET /api/movies/:id/hls/index.m3u8` | HLS master playlist (starts transcode session) |
| `GET /api/movies/:id/hls/:file` | HLS segment / playlist file |
| `DELETE /api/movies/:id/hls` | Stop transcode session |
| `GET /api/movies/:id/subtitles/:streamIndex.vtt` | Subtitle conversion to WebVTT |
| `PUT /api/movies/:id/progress` | Save playback position |
| `DELETE /api/movies/:id/progress` | Clear playback progress |
| `POST /api/movies/rescan` | Trigger movie scan (async) |
| `GET /api/movies/scan/status` | Movie scan progress |

### Testing conventions

- Tests use `supertest` + test-scoped `createApp({cfg, db, scanner})` injection.
- Test config uses a temp `MUSIC_LIBRARY_PATH` and `DATABASE_PATH` — no real library needed.
- `paths.test.ts` verifies traversal prevention exhaustively (symlinks, `..`, absolute paths).
- `keys.test.ts` verifies deterministic SHA-1 stability.
- `db.test.ts` verifies sort-key whitelisting and aggregation.
- `api.test.ts` covers Range streaming (206/200/404), cover bytes, rescan idempotency.
- `video.test.ts` covers movie scanning, thumbnail generation, and HLS transcoding.
- `config.test.ts` verifies env parsing and validation.
- `helpers.ts` provides shared test utilities (temp dirs, test file creation).

### Key design decisions

- **No transcoding** (audio): files stream as-is; browser codec support determines playability. ALAC is converted to FLAC on first playback and cached.
- **On-demand transcoding** (video): MKV/AVI/HEVC/H.265 → HLS via FFmpeg; compatible MP4 plays directly.
- **Hardware H.264 encoding** on macOS via VideoToolbox; `libx264` fallback on other platforms.
- **No accounts**: everything is local-first; preferences in localStorage.
- **Single-port production**: `npm run build` + `npm start` serves everything from `localhost:3000`.
- **Deterministic IDs**: SHA-1 of normalized names means IDs survive re-scans and DB wipes.
- **Dotenv loaded from repo root**: `config.ts` resolves `PROJECT_ROOT` from `import.meta.url`, not `process.cwd`.
- **Configuration reference**: see `.env.example` at the repo root for all supported variables with comments.
