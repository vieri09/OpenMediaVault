# OpenMedia

A self-hosted, browser-based player for music and movies stored on your own
drives. Dark, minimalist, keyboard-driven, and **private by design** — there is
no account system, no login, no cloud, and no streaming service. It scans local
folders you choose, caches metadata in SQLite, and plays your media in the
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
- **Local movie library** for MP4, M4V, MKV and AVI files.
- **Optimized video playback:** compatible H.264 MP4 plays directly; MKV, AVI,
  HEVC/H.265 and incompatible audio use an on-demand FFmpeg → HLS session.
- **Hardware H.264 encoding on macOS** through VideoToolbox when available,
  with a constrained `libx264` fallback elsewhere.
- **Lazy local thumbnails**, movie search/sorting, resume progress, and
  Continue Watching.

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

> **Requirements:** Node.js 20+, npm, and [ffmpeg](https://ffmpeg.org/) +
> `ffprobe` for movie scanning/playback and ALAC compatibility conversion.

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
MOVIE_LIBRARY_PATH=/path/to/your/movies
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
and the frontend (Vite, on port `5173`). With the default
`APP_HOST=127.0.0.1`, open the app in your browser:

```
http://localhost:5173
```

To use development mode from another device on the same trusted Wi-Fi, set
`APP_HOST=0.0.0.0`, restart `npm run dev`, and open
`http://<this-computer's-LAN-IP>:5173` on that device.

On first launch, if the library is empty the backend **scans automatically**.
After that it boots instantly from the cache. You can always trigger a rescan
from the **“Rescan Library”** button in the sidebar.

---

## ⚙️ Configuration

All settings live in `.env` at the project root (read by the server on startup).

| Variable | Default | Description |
|---|---|---|
| `MUSIC_LIBRARY_PATH` | `./music` | Folder scanned recursively for audio. **Set this to your music.** |
| `MOVIE_LIBRARY_PATH` | _(unset)_ | Optional folder scanned recursively for MP4, M4V, MKV and AVI movies. |
| `APP_PORT` | `3000` | Port for the backend API (and the production SPA). |
| `APP_HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` only for intentional LAN access. |
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
best-effort basis). Add rare formats with `EXTRA_AUDIO_EXTENSIONS`. Music is
streamed as its original bytes whenever the browser supports it. ALAC audio
inside M4A is converted losslessly to FLAC on first playback and cached under
`data/transcodes`; no audio information is discarded.

## 🎬 Movie playback

- The movie library mirrors the directory tree under `MOVIE_LIBRARY_PATH`.
  Folders and videos are sorted alphabetically; OpenMedia does not guess show,
  season, episode, OVA, or special metadata from filenames.
- MP4/M4V containing H.264 video and AAC/MP3 audio uses native browser playback
  with HTTP Range seeking.
- MKV and AVI use an ephemeral HLS session. Browser-compatible 8-bit H.264 and
  AAC are copied unchanged rather than re-encoded.
- HEVC/H.265, H.264 Hi10P/4:2:2/4:4:4, and other incompatible video are
  remuxed unchanged into fragmented-MP4 HLS when the browser advertises HEVC
  support. Other browsers receive high-quality H.264 at the source resolution;
  HDR/PQ/HLG sources are tone-mapped to standards-compliant BT.709 rather than
  carrying invalid HDR signaling into an 8-bit stream. The hardware encoder
  uses a resolution-scaled 8–45 Mbps target without speed-priority mode; the
  software fallback uses x264 CRF 18. Incompatible audio is converted to
  512 kbps AAC while preserving the source channel layout.
- Multiple audio tracks can be selected during HLS playback. Text subtitles
  (including SRT, ASS/SSA, mov_text, and WebVTT) are converted to WebVTT only
  when selected. Conversion seeks directly to an overlapping window around the
  current position, caches it under `data/movie-subtitles`, and retimes it after
  HLS seeks; image-based subtitles such as PGS are not exposed.
- HLS uses short four-second segments, builds an approximately 12-second
  startup cushion, and keeps up to about 45 seconds queued ahead in the browser.
  A single active server transcode session prevents competing conversions.
- Seeking beyond generated HLS data restarts FFmpeg at the requested position.
- HLS scratch data is stored in the operating-system temp directory and removed
  when idle or when playback closes. Whole converted movies are not retained.
- Thumbnails are generated only when visible movie cards request them, then
  cached under `data/movie-thumbnails`.

The movie pipeline takes architectural inspiration from
[Retlix](https://github.com/simoncena/retlix), adapted for local-drive files
without IPTV, providers, remote metadata, accounts, or live television.

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

Then open `http://localhost:3000/music` for the independent music player or
`http://localhost:3000/movie` for the movie library. The root URL redirects to
music, and older unprefixed links redirect to their new locations. In this mode
the whole app — both UIs and the API — is served from one origin. It binds to
loopback by default because there is no account system. To intentionally allow
LAN access, set `APP_HOST=0.0.0.0` and protect the service with a trusted
firewall or authenticated reverse proxy.

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

- **Browser codec limits still apply.** Music streams as-is except for lossless
  ALAC→FLAC compatibility conversion. Movies that the browser cannot decode
  require the high-quality HLS compatibility path described above.
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
