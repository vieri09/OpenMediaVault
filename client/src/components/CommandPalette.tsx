import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Album as AlbumIcon, User } from 'lucide-react';
import { useUI } from '../stores/ui.ts';
import { usePlayer } from '../stores/player.ts';
import { api, coverUrl } from '../api.ts';
import type { SearchResult } from '../types.ts';

interface Item {
  key: string;
  label: string;
  sub?: string;
  icon?: 'nav' | 'track' | 'album' | 'artist';
  coverTrackId?: string;
  activate: () => void;
}

export default function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const playTrack = usePlayer((s) => s.playTrack);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + reset on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      api
        .search(q, 8)
        .then(setResults)
        .catch(() => setResults(null));
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open]);

  const navItems: Item[] = useMemo(
    () => [
      { key: 'nav-lib', label: 'Go to Library', icon: 'nav', activate: () => navigate('/') },
      { key: 'nav-albums', label: 'Go to Albums', icon: 'nav', activate: () => navigate('/albums') },
      { key: 'nav-artists', label: 'Go to Artists', icon: 'nav', activate: () => navigate('/artists') },
      { key: 'nav-songs', label: 'Go to Songs', icon: 'nav', activate: () => navigate('/songs') },
      { key: 'nav-genres', label: 'Go to Genres', icon: 'nav', activate: () => navigate('/genres') },
    ],
    [navigate],
  );

  const items: Item[] = useMemo(() => {
    const list: Item[] = [];
    if (!query.trim()) {
      return navItems;
    }
    if (results) {
      for (const t of results.tracks) {
        list.push({
          key: `t-${t.id}`,
          label: t.title,
          sub: t.artist,
          icon: 'track',
          coverTrackId: t.id,
          activate: () => {
            playTrack(t);
            setOpen(false);
          },
        });
      }
      for (const a of results.albums) {
        list.push({
          key: `a-${a.id}`,
          label: a.title,
          sub: a.albumArtist,
          icon: 'album',
          activate: () => {
            navigate(`/albums/${a.id}`);
            setOpen(false);
          },
        });
      }
      for (const ar of results.artists) {
        list.push({
          key: `ar-${ar.id}`,
          label: ar.name,
          sub: `${ar.trackCount} song${ar.trackCount === 1 ? '' : 's'}`,
          icon: 'artist',
          activate: () => {
            navigate(`/artists/${ar.id}`);
            setOpen(false);
          },
        });
      }
    }
    return list;
  }, [query, results, navItems, playTrack, setOpen, navigate]);

  useEffect(() => {
    setActive(0);
  }, [items.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.activate();
    }
  };

  let group = '';

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px' }}>
          <SearchIcon size={18} style={{ color: 'var(--text-faint)' }} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search songs, albums, artists…  (↵ to play / open)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="palette-results">
          {items.length === 0 ? (
            <div className="palette-empty">{query ? 'No results.' : 'Type to search your library.'}</div>
          ) : (
            items.map((item, i) => {
              const showGroup = item.icon === 'nav' && group !== 'nav';
              if (showGroup) group = 'nav';
              const trackGroup = item.icon === 'track' && group !== 'track';
              if (trackGroup) group = 'track';
              const albumGroup = item.icon === 'album' && group !== 'album';
              if (albumGroup) group = 'album';
              const artistGroup = item.icon === 'artist' && group !== 'artist';
              if (artistGroup) group = 'artist';
              return (
                <div key={item.key}>
                  {(showGroup || trackGroup || albumGroup || artistGroup) && (
                    <div className="palette-group">
                      {item.icon === 'nav' ? 'Navigate' : item.icon === 'track' ? 'Tracks' : item.icon === 'album' ? 'Albums' : 'Artists'}
                    </div>
                  )}
                  <button
                    className={`palette-item ${i === active ? 'focused' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => item.activate()}
                  >
                    {item.coverTrackId ? (
                      <img src={coverUrl(item.coverTrackId)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    ) : item.icon === 'album' ? (
                      <AlbumIcon size={18} style={{ color: 'var(--text-faint)' }} />
                    ) : item.icon === 'artist' ? (
                      <User size={18} style={{ color: 'var(--text-faint)' }} />
                    ) : (
                      <SearchIcon size={18} style={{ color: 'var(--text-faint)' }} />
                    )}
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontWeight: 600 }}>{item.label}</div>
                      {item.sub && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.sub}</div>}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
