import { Link } from 'react-router-dom';
import { X, Trash2 } from 'lucide-react';
import { usePlayer } from '../stores/player.ts';
import { useUI } from '../stores/ui.ts';
import { formatTime } from '../lib/format.ts';
import { Cover } from './Cover.tsx';

export default function QueuePanel() {
  const open = useUI((s) => s.queueOpen);
  const setOpen = useUI((s) => s.setQueueOpen);
  const queue = usePlayer((s) => s.queue);
  const order = usePlayer((s) => s.order);
  const currentIndex = usePlayer((s) => s.index);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const clearQueue = usePlayer((s) => s.clearQueue);

  return (
    <>
      <div className={`overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <aside className={`queue-panel ${open ? 'open' : ''}`} aria-label="Play queue">
        <div className="queue-header">
          <h3>Queue</h3>
          <div style={{ display: 'flex', gap: 4 }}>
            {queue.length > 0 && (
              <button className="btn-icon" title="Clear queue" onClick={clearQueue} aria-label="Clear queue">
                <Trash2 size={17} />
              </button>
            )}
            <button className="btn-icon" title="Close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="queue-list">
          {queue.length === 0 ? (
            <div className="queue-empty">
              The queue is empty.
              <br />
              Play an album or add songs from your library.
            </div>
          ) : (
            order.map((qi, position) => {
              const track = queue[qi];
              if (!track) return null;
              const isCurrent = position === currentIndex;
              return (
                <div
                  key={`${track.id}-${position}`}
                  className={`queue-item ${isCurrent ? 'current' : ''}`}
                  onClick={() => jumpTo(position)}
                >
                  <Cover coverTrackId={track.id} hasCover={track.hasCover} alt="" className="queue-thumb" />
                  <div className="qi-meta">
                    <div className="qi-t">{track.title}</div>
                    <div className="qi-a">{track.artist || 'Unknown Artist'}</div>
                  </div>
                  <span className="qi-a" style={{ flexShrink: 0 }}>{formatTime(track.duration)}</span>
                  <button
                    className="btn-icon btn-sm"
                    title="Remove from queue"
                    aria-label="Remove from queue"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromQueue(position);
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 12 }}>
          <Link to="/music/nowplaying" onClick={() => setOpen(false)} style={{ color: 'var(--text-muted)' }}>
            Open Now Playing →
          </Link>
        </div>
      </aside>
    </>
  );
}
