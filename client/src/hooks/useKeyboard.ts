import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../stores/player.ts';
import { useUI } from '../stores/ui.ts';

/** True if keyboard events should be treated as player shortcuts (not typing). */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/**
 * Global keyboard shortcuts, mirroring Monochrome's scheme:
 *   Space        play/pause
 *   ← / →        seek -/+ 10s
 *   Shift+← / →  previous / next track
 *   ↑ / ↓        volume -/+ 5%
 *   M            mute toggle
 *   S            shuffle toggle
 *   R            repeat cycle
 *   Q            queue panel
 *   /            focus search
 *   Cmd/Ctrl+K   command palette
 *   Esc          close panels
 */
export function useKeyboard(searchRef: React.RefObject<HTMLInputElement | null>): void {
  const navigate = useNavigate();
  const player = usePlayer();
  const ui = useUI();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);

      // Escape works everywhere to close overlays.
      if (e.key === 'Escape') {
        if (ui.paletteOpen) ui.setPaletteOpen(false);
        else if (ui.queueOpen) ui.setQueueOpen(false);
        else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }

      // Command palette: works even while typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.togglePalette();
        return;
      }

      if (typing) return;

      // Focus search with "/"
      if (e.key === '/') {
        e.preventDefault();
        if (searchRef.current) {
          searchRef.current.focus();
          searchRef.current.select();
        } else {
          navigate('/music/search');
        }
        return;
      }

      switch (e.key) {
        case ' ':
        case 'Spacebar': {
          e.preventDefault();
          player.togglePlay();
          break;
        }
        case 'ArrowLeft': {
          if (e.shiftKey) {
            e.preventDefault();
            player.prev();
          } else {
            e.preventDefault();
            player.seekBy(-10);
          }
          break;
        }
        case 'ArrowRight': {
          if (e.shiftKey) {
            e.preventDefault();
            player.next();
          } else {
            e.preventDefault();
            player.seekBy(10);
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          player.setVolume(player.volume + 0.05);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          player.setVolume(player.volume - 0.05);
          break;
        }
        case 'm':
        case 'M':
          player.toggleMute();
          break;
        case 's':
        case 'S':
          player.toggleShuffle();
          break;
        case 'r':
        case 'R':
          player.cycleRepeat();
          break;
        case 'q':
        case 'Q':
          ui.toggleQueue();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, ui, navigate, searchRef]);
}
