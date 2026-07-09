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
| `routes.ts` | All `/api/*` endpoints. `buildRouter(svc)` takes `{cfg, db, scanner}` for DI. |
| `stream.ts` | HTTP Range-aware audio streaming. |
| `index.ts` | Express app factory + bootstrap. Error middleware. Production SPA serving. |

**Security invariants:**
- Clients reference **track IDs only** (SHA-1 of relative path), never filesystem paths.
- `resolveWithin()` rejects absolute paths and `..` traversal outside `MUSIC_LIBRARY_PATH`.
- SQL sort keys are whitelisted (`ALBUM_SORT`, `TRACK_SORT` maps), never interpolated from query params.

### Client (`client/`)

React 18 + Vite + TypeScript. React Router v6 with a root layout + nested pages.

**State management (all zustand, persisted to localStorage):**
- `stores/player.ts` — Queue state machine: `queue` (stable order) + `order` (playback permutation). Shuffle pins current track at front via Fisher-Yates. Repeat modes: off / all / one.
- `stores/library.ts` — Favorites set + recently played list (capped at 100).
- `stores/ui.ts` — UI flags (queue panel, command palette visibility).

**Data fetching:** SWR with a custom `fetcher` in `main.tsx`. Typed API client in `api.ts` (`getJSON<T>()` helper). Stream/cover URLs returned as strings for direct `<audio>`/`<img>` use.

**Pages:** Library, Albums, AlbumDetail, Artists, ArtistDetail, Genres, Songs, Search, NowPlaying — all under `pages/`.

**Components:** Player (bottom bar + audio element), QueuePanel (slide-out), CommandPalette (⌘K), TrackList, Grids, Cover, RescanButton.

**Hooks:** `useKeyboard` (global hotkeys matching Monochrome scheme), `useMediaSession` (OS media controls).

**Routing** (`main.tsx`):
```
/              → Library (index)
/albums        → Albums list
/albums/:id    → Album detail
/artists       → Artists list
/artists/:id   → Artist detail
/genres        → Genres list
/songs         → Songs list
/search        → Search results
/nowplaying    → Now playing view
```

### API

All endpoints at `/api/*`. Key patterns: paginated lists with whitelisted sort keys, stable SHA-1 IDs, Range-aware streaming (`GET /api/stream/:id`), embedded cover art (`GET /api/cover/:id`). Rescan is async: `POST /api/rescan` → 202, poll `GET /api/scan/status`.

### Testing conventions

- Tests use `supertest` + test-scoped `createApp({cfg, db, scanner})` injection.
- Test config uses a temp `MUSIC_LIBRARY_PATH` and `DATABASE_PATH` — no real library needed.
- `paths.test.ts` verifies traversal prevention exhaustively (symlinks, `..`, absolute paths).
- `keys.test.ts` verifies deterministic SHA-1 stability.
- `db.test.ts` verifies sort-key whitelisting and aggregation.
- `api.test.ts` covers Range streaming (206/200/404), cover bytes, rescan idempotency.

### Key design decisions

- **No transcoding**: files stream as-is; browser codec support determines playability.
- **No accounts**: everything is local-first; preferences in localStorage.
- **Single-port production**: `npm run build` + `npm start` serves everything from `localhost:3000`.
- **Deterministic IDs**: SHA-1 of normalized names means IDs survive re-scans and DB wipes.
- **Dotenv loaded from repo root**: `config.ts` resolves `PROJECT_ROOT` from `import.meta.url`, not `process.cwd()`.
