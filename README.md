# OpenMedia

A self-hosted, browser-based music player that streams from a folder on your own
machine. Dark, minimalist, keyboard-driven, and **private by design** — there is
no account system, no login, no cloud, and no streaming service. It scans a
local folder you choose, caches the metadata, and plays your files in the
browser.

Inspired by the architecture and UI of
[Monochrome](https://github.com/monochrome-music/monochrome), but re-imagined as
a much simpler **local-file** player instead of a TIDAL/streaming client. All
account, social, and cloud features have been intentionally removed.

---

## ✨ Features

- **Scans a local folder recursively** for `mp3`, `flac`, `wav`, `m4a`, `aac`,
  `ogg`, `opus` (and configurable extras).
- **Reads embedded metadata** — title, artist, album, album artist, genre, year,
  duration, track/disc number, and embedded cover art.
- **Metadata cache (SQLite)** so the app starts instantly and never re-scans
  unchanged files.
- **Manual "Rescan Library"** with live progress.
- **HTTP audio streaming with full Range support** for instant seeking.
- **Browse** by Library, Albums, Artists, Genres, and Songs, with sorting.
- **Album detail** and **Artist detail** pages.
- **Search** across tracks, albums, and artists (plus a ⌘/Ctrl+K command palette).
- **Now Playing** view, **Queue** panel, **player bar** with play/pause,
  next/previous, seek, volume, shuffle, and repeat (off / all / one).
- **Keyboard shortcuts** (see below) matching Monochrome's scheme.
- **Media Session API** integration — hardware media keys and OS media controls
  work.
- **PWA** install support.
- **Local preferences** saved in the browser: volume, shuffle/repeat, queue,
  recently played, and favorites. **No server-side accounts.**

---

## 🧱 Architecture

```
OpenMedia-v2/
├── package.json            # npm workspaces (server + client), dev/build/test scripts
├── .env / .env.example     # configuration (music folder, port, db path)
└── server/                 # Node + Express + TypeScript backend
    └── src/
        ├── config.ts       # env → typed config + validation
        ├── paths.ts        # secure path resolution (anti-traversal chokepoint)
        ├── db.ts           # better-sqlite3 schema + queries (whitelisted sorts)
        ├── metadata.ts     # music-metadata parsing → normalized track
        ├── scanner.ts      # recursive scan, incremental (mtime+size), pruning
        ├── stream.ts       # Range-request audio streaming
        ├── routes.ts       # all API endpoints
        ├── logger.ts       # leveled logging
        └── index.ts        # Express app, error middleware, optional SPA serving
└── client/                 # React + Vite + TypeScript frontend
    └── src/
        ├── api.ts          # typed fetch client
        ├── stores/         # zustand: player/queue, library (favorites/recent), ui
        ├── hooks/          # useKeyboard, useMediaSession
        ├── components/     # Player, QueuePanel, CommandPalette, TrackList, Grids…
        ├── pages/          # Library, Albums, AlbumDetail, Artists, ArtistDetail,
        │                   #   Songs, Genres, Search, NowPlaying
        └── styles.css      # dark minimalist CSS variables
```

**Key choices**

| Concern | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript | Componentized pages are maintainable; TS catches bugs |
| State | `zustand` | Tiny, ergonomic player/queue state machine |
| Data fetching | `SWR` | Caching, refetch, dedupe with one small dep |
| Search | server SQL `LIKE` + client command palette | Robust for large libraries, paginated |
| Backend | Express + `better-sqlite3` + `music-metadata` | Simple, fast, no external services |
| Security | clients reference **track IDs only** | No arbitrary filesystem access; all lookups go through `resolveWithin()` |

---

## 🚀 Quick start

> **Requirements:** Node.js 20+ and npm. [ffmpeg](https://ffmpeg.org/) is **not**
> required to run the app — it is only used by the test suite.

### 1. Install dependencies

```bash
npm install
```

This installs both the `server` and `client` workspaces.

### 2. Point the app at your music folder

Create a `.env` at the project root (or copy `.env.example`) and set
`MUSIC_LIBRARY_PATH` to the folder that holds your music:

```bash
cp .env.example .env
# then edit .env:
MUSIC_LIBRARY_PATH=/path/to/your/music
```

The folder is scanned recursively. Example layout:

```
/path/to/your/music
├── Daft Punk/
│   └── Discovery/
│       ├── 01 - One More Time.flac
│       └── 02 - Aerodynamic.flac
└── Radiohead/
    └── OK Computer/
        └── 01 - Airbag.mp3
```

### 3. Run it

```bash
npm run dev
```

This starts **both** the backend API (Express, on `APP_PORT`, default `3000`)
and the frontend (Vite, on `http://localhost:5173`). Open the app in your
browser:

```
http://localhost:5173
```

On first launch, if the library is empty the backend **scans automatically**.
After that it boots instantly from the cache. You can always trigger a rescan
from the **“Rescan Library”** button in the sidebar.

---

## ⚙️ Configuration

All settings live in `.env` at the project root (read by the server on startup).

| Variable | Default | Description |
|---|---|---|
| `MUSIC_LIBRARY_PATH` | `./music` | Folder scanned recursively for audio. **Set this to your music.** |
| `APP_PORT` | `3000` | Port for the backend API (and the production SPA). |
| `DATABASE_PATH` | `./data/library.db` | Where the SQLite metadata cache lives. |
| `EXTRA_AUDIO_EXTENSIONS` | _(empty)_ | Comma-separated extra extensions, e.g. `aif,m4b,caf`. |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |

---

## 🔄 Scanning & rescanning

- The scanner walks `MUSIC_LIBRARY_PATH` recursively, skipping dotfiles/hidden
  directories.
- **Incremental:** a file is only re-parsed when its size or modification time
  changed. Everything else is skipped, so rescans are fast.
- Files deleted from disk are **pruned** from the cache automatically.
- **Trigger a rescan** at any time:
  - In the app: **“Rescan Library”** in the sidebar (shows live progress).
  - Via API: `POST http://localhost:3000/api/rescan`, then poll
    `GET /api/scan/status`.

---

## 🎵 Supported formats

`mp3`, `flac`, `wav`, `m4a`, `aac`, `ogg`, `opus` (+ `oga`, `weba`, `wma` on a
best-effort basis). Add rare formats with `EXTRA_AUDIO_EXTENSIONS`. Whether a
given file plays in the browser ultimately depends on the browser's codec
support (Safari and Chrome differ on FLAC/Opus).

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Play / Pause |
| `←` / `→` | Seek −/+ 10s |
| `Shift` + `←` / `→` | Previous / Next track |
| `↑` / `↓` | Volume up / down |
| `M` | Mute / Unmute |
| `S` | Toggle shuffle |
| `R` | Cycle repeat (off → all → one) |
| `Q` | Toggle queue |
| `/` | Focus search |
| `Cmd`/`Ctrl` + `K` | Command palette |
| `Esc` | Close panels / blur |

Shortcuts are ignored while typing in inputs.

---

## 🌐 Production / single-port mode

For a single self-hosted port, build the client and let the backend serve it:

```bash
npm run build      # builds client/ into client/dist
npm start          # runs the server; serves the SPA at / and the API at /api
```

Then open `http://localhost:3000`. In this mode the whole app — UI and API — is
served from one origin (handy for putting behind a reverse proxy or accessing
from another machine on your LAN).

> Note: in production the server is run via `tsx` (TypeScript is executed
> on-the-fly). This keeps the setup simple and is fine for personal self-hosted
> use.

---

## 🧪 Development scripts

Run from the project root:

| Command | Description |
|---|---|
| `npm run dev` | Start backend + frontend together (concurrently) |
| `npm run build` | Build the client + typecheck the server |
| `npm start` | Run the production server (serves built client + API) |
| `npm run typecheck` | Typecheck both workspaces |
| `npm run lint` | ESLint both workspaces |
| `npm test` | Run the backend test suite (Vitest) |

Per-workspace scripts (`npm run <script> -w server` / `-w client`) are also
available (e.g. `dev`, `test:watch`).

### Tests

The backend test suite covers the security-critical and behavior-critical paths:
secure path resolution (traversal prevention), HTTP Range parsing, key
determinism, SQLite aggregation & sort-key whitelisting, the full scanner
(incremental skip, pruning of deleted files), and the API end-to-end (stream
206/200/404, cover bytes/404, rescan idempotency).

```bash
npm test
```

> The scanner/API integration tests generate tiny MP3s with `ffmpeg`, so the
> suite auto-skips those if `ffmpeg` isn't on your PATH (the pure-logic tests
> still run).

---

## 🔌 API reference

All endpoints are prefixed with `/api`. Public ids are stable SHA-1 hashes; the
browser never requests filesystem paths directly.

| Method & path | Description |
|---|---|
| `GET /api/health` | Liveness probe. |
| `GET /api/library/summary` | Counts of tracks/albums/artists/genres + total duration + config status. |
| `GET /api/tracks` | List tracks. `?sort=title\|artist\|album\|duration\|date_added&order=asc\|desc&page&limit&search&genre`. |
| `GET /api/albums` | List albums. `?sort=title\|artist\|year\|recently_added&order&page&limit&search`. |
| `GET /api/albums/recent` | Recently added albums (`?limit`). |
| `GET /api/albums/:id` | Album detail incl. ordered tracks. |
| `GET /api/artists` | List artists. `?order&page&limit&search`. |
| `GET /api/artists/:id` | Artist detail incl. albums + tracks. |
| `GET /api/genres` | All genres with counts. |
| `GET /api/search?q=` | Search tracks/albums/artists. |
| `GET /api/stream/:id` | Stream audio (HTTP `Range` aware). |
| `GET /api/cover/:id` | Embedded cover art for a track. |
| `POST /api/rescan` | Trigger a rescan (async). |
| `GET /api/scan/status` | Current scan progress / last result. |

**Security:** every stream/cover request is resolved from a server-side track id
to a validated relative path through `resolveWithin()`, which rejects absolute
paths and any `..` traversal outside `MUSIC_LIBRARY_PATH`. The browser cannot
request arbitrary files.

---

## ⚠️ Known limitations

- **No transcoding.** Files are streamed as-is; playback depends on the
  browser's native codec support (e.g. Opus may not play in Safari).
- **No gapless playback** — the browser `<audio>` element has a small gap
  between tracks.
- **Single library folder.** Point `MUSIC_LIBRARY_PATH` at one root; nested
  subfolders are scanned. (Symlinks inside the root are followed, but only if
  they resolve back inside the root.)
- **Single-user, local-first.** There is intentionally no account system, sync,
  sharing, or multi-device cloud. Preferences live in each browser's
  `localStorage`.
- **PWA icons are placeholders.** Replace `client/public/icon-{192,512}.png`
  with your own for a polished install experience.
- **Very large libraries** (tens of thousands of albums) may benefit from
  higher pagination limits or additional DB tuning, but the defaults handle
  typical personal libraries comfortably.

---

## 📄 License

MIT. Built as a personal, private alternative to streaming-service clients.
