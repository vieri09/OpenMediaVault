import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom';
import { SWRConfig } from 'swr';
import './styles.css';
import App from './App.tsx';
import MovieApp from './MovieApp.tsx';
import LegacyRedirect from './components/LegacyRedirect.tsx';

const Library = lazy(() => import('./pages/Library.tsx'));
const Albums = lazy(() => import('./pages/Albums.tsx'));
const AlbumDetail = lazy(() => import('./pages/AlbumDetail.tsx'));
const Artists = lazy(() => import('./pages/Artists.tsx'));
const ArtistDetail = lazy(() => import('./pages/ArtistDetail.tsx'));
const Songs = lazy(() => import('./pages/Songs.tsx'));
const SearchPage = lazy(() => import('./pages/Search.tsx'));
const NowPlaying = lazy(() => import('./pages/NowPlaying.tsx'));
const Genres = lazy(() => import('./pages/Genres.tsx'));
const Movies = lazy(() => import('./pages/Movies.tsx'));
const MovieDetail = lazy(() => import('./pages/MovieDetail.tsx'));
const ContinueWatching = lazy(() => import('./pages/ContinueWatching.tsx'));
const VideoPlayer = lazy(() => import('./pages/VideoPlayer.tsx'));

const pageFallback = <div className="loading"><div className="spinner" />Loading…</div>;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status}`);
  }
  return res.json();
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, dedupingInterval: 2000 }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/music" replace />} />
          <Route path="/music" element={<App />}>
            <Route element={<Suspense fallback={pageFallback}><Outlet /></Suspense>}>
              <Route index element={<Library />} />
              <Route path="albums" element={<Albums />} />
              <Route path="albums/:id" element={<AlbumDetail />} />
              <Route path="artists" element={<Artists />} />
              <Route path="artists/:id" element={<ArtistDetail />} />
              <Route path="genres" element={<Genres />} />
              <Route path="songs" element={<Songs />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="nowplaying" element={<NowPlaying />} />
              <Route path="*" element={<Navigate to="/music" replace />} />
            </Route>
          </Route>
          <Route path="/movie" element={<MovieApp />}>
            <Route element={<Suspense fallback={pageFallback}><Outlet /></Suspense>}>
              <Route index element={<Movies />} />
              <Route path="continue" element={<ContinueWatching />} />
              <Route path="folder/:folderId" element={<Movies />} />
              <Route path=":id" element={<MovieDetail />} />
              <Route path="*" element={<Navigate to="/movie" replace />} />
            </Route>
          </Route>
          <Route
            path="/movie/watch/:id"
            element={<Suspense fallback={pageFallback}><VideoPlayer /></Suspense>}
          />
          <Route path="/albums/*" element={<LegacyRedirect from="/albums" to="/music/albums" />} />
          <Route path="/artists/*" element={<LegacyRedirect from="/artists" to="/music/artists" />} />
          <Route path="/genres/*" element={<LegacyRedirect from="/genres" to="/music/genres" />} />
          <Route path="/songs/*" element={<LegacyRedirect from="/songs" to="/music/songs" />} />
          <Route path="/search/*" element={<LegacyRedirect from="/search" to="/music/search" />} />
          <Route path="/nowplaying" element={<Navigate to="/music/nowplaying" replace />} />
          <Route path="/movies/*" element={<LegacyRedirect from="/movies" to="/movie" />} />
          <Route path="/watch/*" element={<LegacyRedirect from="/watch" to="/movie/watch" />} />
          <Route path="*" element={<Navigate to="/music" replace />} />
        </Routes>
      </BrowserRouter>
    </SWRConfig>
  </React.StrictMode>,
);
