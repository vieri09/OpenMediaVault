import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import type { Album, AlbumDetail, Artist, Track } from '../types.ts';
import { usePlayer } from '../stores/player.ts';
import { Cover } from './Cover.tsx';
import { api } from '../api.ts';

interface AlbumGridProps {
  albums: Album[];
}

export function AlbumGrid({ albums }: AlbumGridProps) {
  if (albums.length === 0) return <div className="empty-state">No albums.</div>;
  return (
    <div className="grid">
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} />
      ))}
    </div>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const playTracks = usePlayer((s) => s.playTracks);
  // Fetch the album's tracks on demand when the play button is clicked.
  const handlePlay = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const detail: AlbumDetail = await api.albumDetail(album.id);
      if (detail.tracks && detail.tracks.length > 0) playTracks(detail.tracks as Track[], 0);
    } catch {
      /* ignore */
    }
  };
  return (
    <Link to={`/music/albums/${album.id}`} className="card">
      <div className="card-cover">
        <Cover coverTrackId={album.coverTrackId} hasCover={album.hasCover} alt={album.title} className="card-cover" />
        <button className="card-play" onClick={handlePlay} title={`Play ${album.title}`} aria-label="Play">
          <Play size={18} fill="currentColor" />
        </button>
      </div>
      <p className="card-title">{album.title}</p>
      <p className="card-meta">{album.albumArtist}{album.year ? ` · ${album.year}` : ''}</p>
    </Link>
  );
}

interface ArtistGridProps {
  artists: Artist[];
}

export function ArtistGrid({ artists }: ArtistGridProps) {
  if (artists.length === 0) return <div className="empty-state">No artists.</div>;
  return (
    <div className="grid grid-artists">
      {artists.map((artist) => (
        <Link key={artist.id} to={`/music/artists/${artist.id}`} className="card">
          <div className="artist-avatar">
            <span>{initials(artist.name)}</span>
          </div>
          <p className="card-title" style={{ textAlign: 'center' }}>{artist.name}</p>
          <p className="card-meta" style={{ textAlign: 'center' }}>
            {artist.trackCount} song{artist.trackCount === 1 ? '' : 's'}
          </p>
        </Link>
      ))}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
