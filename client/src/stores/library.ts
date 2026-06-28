import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '../types.ts';

const RECENT_LIMIT = 100;

interface LibraryState {
  /** Set of favorited track ids. */
  favorites: string[];
  /** Recently played tracks (most recent first), newest at front. */
  recentlyPlayed: Track[];

  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  pushRecent: (track: Track) => void;
  clearRecent: () => void;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recentlyPlayed: [],

      isFavorite: (id) => get().favorites.includes(id),

      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((f) => f !== id)
            : [...s.favorites, id],
        })),

      pushRecent: (track) =>
        set((s) => {
          const filtered = s.recentlyPlayed.filter((t) => t.id !== track.id);
          return { recentlyPlayed: [track, ...filtered].slice(0, RECENT_LIMIT) };
        }),

      clearRecent: () => set({ recentlyPlayed: [] }),
    }),
    { name: 'openmedia-library' },
  ),
);
