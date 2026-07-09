import { useRef } from 'react';
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
import QueuePanel from './components/QueuePanel.tsx';
import CommandPalette from './components/CommandPalette.tsx';
import RescanButton from './components/RescanButton.tsx';
import { useUI } from './stores/ui.ts';
import { useKeyboard } from './hooks/useKeyboard.ts';
import { useMediaSession } from './hooks/useMediaSession.ts';

export default function App() {
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const togglePalette = useUI((s) => s.togglePalette);

  // While the immersive Now Playing view is open it becomes the sole control
  // surface, so the floating mini-player is hidden via this class.
  const onNowPlaying = location.pathname === '/nowplaying';

  useKeyboard(searchRef);
  useMediaSession();

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const q = searchRef.current?.value.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
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
        <NavLink to="/" end className={linkClass}>
          <Library size={18} /> Library
        </NavLink>
        <NavLink to="/albums" className={linkClass}>
          <Disc3 size={18} /> Albums
        </NavLink>
        <NavLink to="/artists" className={linkClass}>
          <Mic2 size={18} /> Artists
        </NavLink>
        <NavLink to="/genres" className={linkClass}>
          <Sliders size={18} /> Genres
        </NavLink>
        <NavLink to="/songs" className={linkClass}>
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
        <NavLink to="/nowplaying" className={linkClass}>
          <ListMusic size={18} /> Now Playing
        </NavLink>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <Player />
      <QueuePanel />
      <CommandPalette />
    </div>
  );
}
