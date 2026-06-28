import { useState } from 'react';
import { Music } from 'lucide-react';
import { coverUrl } from '../api.ts';

interface CoverProps {
  /** A track id that has cover art (used to fetch the image). */
  coverTrackId: string | null | undefined;
  hasCover?: boolean;
  alt: string;
  className?: string;
  rounded?: boolean;
}

/**
 * Renders an album cover image, falling back to a neutral placeholder when
 * there is no embedded artwork or the image fails to load.
 */
export function Cover({ coverTrackId, hasCover, alt, className, rounded }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const showImage = coverTrackId && (hasCover ?? true) && !failed;

  return (
    <div className={className} style={{ overflow: 'hidden' }}>
      {showImage ? (
        <img
          src={coverUrl(coverTrackId!)}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: rounded ? undefined : 0 }}
        />
      ) : (
        <div className="cover-fallback" style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
          <Music size={28} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
