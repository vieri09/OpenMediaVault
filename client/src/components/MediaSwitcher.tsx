import { Clapperboard, Music2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export default function MediaSwitcher() {
  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `media-switcher-link ${isActive ? 'active' : ''}`;

  return (
    <nav className="media-switcher" aria-label="Switch media player">
      <NavLink to="/music" className={linkClass}>
        <Music2 size={15} />
        <span>Music</span>
      </NavLink>
      <NavLink to="/movie" className={linkClass}>
        <Clapperboard size={15} />
        <span>Movie</span>
      </NavLink>
    </nav>
  );
}
