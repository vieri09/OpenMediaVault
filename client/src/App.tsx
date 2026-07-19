import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Disc3,
  Library,
  Mic2,
  Music2,
  Palette,
  ListMusic,
  Sliders,
} from 'lucide-react';
import Player from './components/Player.tsx';
import MediaSwitcher from './components/MediaSwitcher.tsx';
import RescanButton from './components/RescanButton.tsx';
import { useUI } from './stores/ui.ts';
import { useKeyboard } from './hooks/useKeyboard.ts';
import { useMediaSession } from './hooks/useMediaSession.ts';

const QueuePanel = lazy(() => import('./components/QueuePanel.tsx'));
const CommandPalette = lazy(() => import('./components/CommandPalette.tsx'));

export default function App() {
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const togglePalette = useUI((s) => s.togglePalette);
  const queueOpen = useUI((s) => s.queueOpen);
  const paletteOpen = useUI((s) => s.paletteOpen);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [paletteLoaded, setPaletteLoaded] = useState(false);

  useEffect(() => {
    if (queueOpen) setQueueLoaded(true);
  }, [queueOpen]);
  useEffect(() => {
    if (paletteOpen) setPaletteLoaded(true);
  }, [paletteOpen]);

  // While the immersive Now Playing view is open it becomes the sole control
  // surface, so the floating mini-player is hidden via this class.
  const onNowPlaying = location.pathname === '/music/nowplaying';

  useKeyboard(searchRef);
  useMediaSession();

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const q = searchRef.current?.value.trim();
    if (q) navigate(`/music/search?q=${encodeURIComponent(q)}`);
  };

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `nav-link ${isActive ? 'active' : ''}`;

  return (
    <div className={`app${onNowPlaying ? ' on-nowplaying' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Disc3 size={18} />
          </span>
          <span>OpenMedia</span>
        </div>

        <form onSubmit={onSearchSubmit} style={{ padding: '0 6px 8px' }}>
          <input ref={searchRef} className="input search-input" placeholder="Search…  ( / )" aria-label="Search" />
        </form>

        <div className="nav-section">Browse</div>
        <NavLink to="/music" end className={linkClass}>
          <Library size={18} /> Library
        </NavLink>
        <NavLink to="/music/albums" className={linkClass}>
          <Disc3 size={18} /> Albums
        </NavLink>
        <NavLink to="/music/artists" className={linkClass}>
          <Mic2 size={18} /> Artists
        </NavLink>
        <NavLink to="/music/genres" className={linkClass}>
          <Sliders size={18} /> Genres
        </NavLink>
        <NavLink to="/music/songs" className={linkClass}>
          <Music2 size={18} /> Songs
        </NavLink>

        <div style={{ flex: 1 }} />

        <div className="nav-section">Library</div>
        <RescanButton />
        <button className="nav-link" onClick={togglePalette}>
          <Palette size={18} />
          <span className="nav-label">Command Palette</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd>⌘K</kbd>
          </span>
        </button>
        <NavLink to="/music/nowplaying" className={linkClass}>
          <ListMusic size={18} /> Now Playing
        </NavLink>
        <MediaSwitcher />
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <Player />
      <Suspense fallback={null}>
        {queueLoaded && <QueuePanel />}
        {paletteLoaded && <CommandPalette />}
      </Suspense>
    </div>
  );
}
