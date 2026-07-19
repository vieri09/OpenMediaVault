import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Disc3, History, Library, Palette } from 'lucide-react';
import MediaSwitcher from './components/MediaSwitcher.tsx';
import MovieScanButton from './components/MovieScanButton.tsx';

const MovieCommandPalette = lazy(() => import('./components/MovieCommandPalette.tsx'));

export default function MovieApp() {
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `nav-link ${isActive ? 'active' : ''}`;

  const search = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const query = searchRef.current?.value.trim();
    navigate(query ? `/movie?search=${encodeURIComponent(query)}` : '/movie');
  };

  useEffect(() => {
    if (paletteOpen) setPaletteLoaded(true);
  }, [paletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      } else if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen]);

  return (
    <div className="app movie-app">
      <aside className="sidebar movie-sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Disc3 size={18} />
          </span>
          <span>OpenMedia</span>
        </div>

        <form onSubmit={search} style={{ padding: '0 6px 8px' }}>
          <input
            ref={searchRef}
            className="input search-input"
            placeholder="Search movies…"
            aria-label="Search movies"
          />
        </form>

        <div className="nav-section">Browse</div>
        <NavLink to="/movie" end className={linkClass}>
          <Library size={18} /> Movies
        </NavLink>
        <NavLink to="/movie/continue" className={linkClass}>
          <History size={18} /> Continue Watching
        </NavLink>

        <div style={{ flex: 1 }} />

        <div className="nav-section">Library</div>
        <MovieScanButton />
        <button className="nav-link" onClick={() => setPaletteOpen(true)}>
          <Palette size={18} />
          <span className="nav-label">Command Palette</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd>⌘K</kbd>
          </span>
        </button>
        <MediaSwitcher />
      </aside>

      <main className="main">
        <Outlet />
      </main>
      <Suspense fallback={null}>
        {paletteLoaded && (
          <MovieCommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
        )}
      </Suspense>
    </div>
  );
}
