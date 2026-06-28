import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SWRConfig } from 'swr';
import './styles.css';
import App from './App.tsx';
import Library from './pages/Library.tsx';
import Albums from './pages/Albums.tsx';
import AlbumDetail from './pages/AlbumDetail.tsx';
import Artists from './pages/Artists.tsx';
import ArtistDetail from './pages/ArtistDetail.tsx';
import Songs from './pages/Songs.tsx';
import SearchPage from './pages/Search.tsx';
import NowPlaying from './pages/NowPlaying.tsx';
import Genres from './pages/Genres.tsx';

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
          <Route path="/" element={<App />}>
            <Route index element={<Library />} />
            <Route path="albums" element={<Albums />} />
            <Route path="albums/:id" element={<AlbumDetail />} />
            <Route path="artists" element={<Artists />} />
            <Route path="artists/:id" element={<ArtistDetail />} />
            <Route path="genres" element={<Genres />} />
            <Route path="songs" element={<Songs />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="nowplaying" element={<NowPlaying />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SWRConfig>
  </React.StrictMode>,
);
