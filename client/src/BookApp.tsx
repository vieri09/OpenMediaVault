import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BookOpen, Disc3, History, Palette, RefreshCw } from 'lucide-react';
import MediaSwitcher from './components/MediaSwitcher.tsx';
import { bookSummary, rescanBooks, bookScanStatus } from './api.ts';
import type { BookSummary, ScanStatus } from './types.ts';

const BookCommandPalette = lazy(() => import('./components/BookCommandPalette.tsx'));

export default function BookApp() {
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `nav-link ${isActive ? 'active' : ''}`;

  const search = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const query = searchRef.current?.value.trim();
    navigate(query ? `/book?search=${encodeURIComponent(query)}` : '/book');
  };

  useEffect(() => {
    bookSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    if (paletteOpen) setPaletteLoaded(true);
  }, [paletteOpen]);

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => {
      bookScanStatus().then((status) => {
        setScanStatus(status);
        if (!status.scanning) {
          setScanning(false);
          bookSummary().then(setSummary).catch(() => {});
        }
      });
    }, 800);
    return () => clearInterval(interval);
  }, [scanning]);

  const triggerRescan = () => {
    setScanning(true);
    rescanBooks().then(setScanStatus).catch(() => setScanning(false));
  };

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
    <div className="app book-app">
      <aside className="sidebar book-sidebar">
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
            placeholder="Search books…"
            aria-label="Search books"
          />
        </form>

        <div className="nav-section">Browse</div>
        <NavLink to="/book" end className={linkClass}>
          <BookOpen size={18} /> Books
        </NavLink>
        <NavLink to="/book/continue" className={linkClass}>
          <History size={18} /> Continue Reading
        </NavLink>

        <div style={{ flex: 1 }} />

        <div className="nav-section">Library</div>
        <button className="nav-link" onClick={triggerRescan} disabled={scanning}>
          <RefreshCw size={18} className={scanning ? 'spin' : ''} />
          <span className="nav-label">
            {scanning
              ? `Scanning… ${scanStatus ? `${scanStatus.processed}/${scanStatus.total}` : ''}`
              : 'Rescan Books'}
          </span>
        </button>
        <button className="nav-link" onClick={() => setPaletteOpen(true)}>
          <Palette size={18} />
          <span className="nav-label">Command Palette</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd>⌘K</kbd>
          </span>
        </button>
        {summary && (
          <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--text-faint)' }}>
            {summary.bookCount} book{summary.bookCount !== 1 ? 's' : ''}
          </div>
        )}
        <MediaSwitcher />
      </aside>

      <main className="main">
        <Outlet />
      </main>
      <Suspense fallback={null}>
        {paletteLoaded && (
          <BookCommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
        )}
      </Suspense>
    </div>
  );
}
