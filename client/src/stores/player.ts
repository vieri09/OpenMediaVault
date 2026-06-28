import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RepeatMode, Track } from '../types.ts';

/**
 * The player/queue state machine.
 *
 * `queue` holds tracks in stable (insertion/album) order. `order` is a
 * permutation of indices into `queue` — when shuffle is on it is a
 * Fisher–Yates shuffle with the currently playing track pinned to the front,
 * so toggling shuffle never interrupts the current song. `index` is a
 * position within `order`.
 */
interface PlayerState {
  queue: Track[];
  order: number[];
  index: number; // position within `order`; -1 means empty
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /**
   * A seek request from the UI/keyboard, separate from `currentTime` (which is
   * driven by the audio element's timeupdate). The Player component consumes
   * this and clears it, avoiding feedback loops. `null` = no pending seek.
   */
  pendingSeek: number | null;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;

  // ── selectors ──
  currentTrack: () => Track | null;
  currentIndexInQueue: () => number;

  // ── queue mutations ──
  playTracks: (tracks: Track[], startIndex?: number) => void;
  playTrack: (track: Track) => void;
  addToQueue: (tracks: Track[]) => void;
  playNext: (tracks: Track[]) => void;
  removeFromQueue: (position: number) => void; // position in `order`
  jumpTo: (position: number) => void; // position in `order`
  clearQueue: () => void;

  // ── transport ──
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPendingSeek: (t: number | null) => void;

  // ── prefs ──
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setMuted: (m: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Fisher–Yates shuffle of [0..n-1] with `pin` forced to position 0. */
function shuffledOrder(n: number, pin: number): number[] {
  const arr = identityOrder(n);
  // Move pin to front.
  if (pin > 0 && pin < n) {
    [arr[0], arr[pin]] = [arr[pin], arr[0]];
  }
  // Shuffle the rest (indices 1..n-1).
  for (let i = arr.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.random() * i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      order: [],
      index: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      pendingSeek: null,
      volume: 0.8,
      muted: false,
      shuffle: false,
      repeat: 'off',

      currentTrack: () => {
        const { queue, order, index } = get();
        if (index < 0 || order.length === 0) return null;
        const qi = order[index];
        return qi >= 0 && qi < queue.length ? queue[qi] : null;
      },

      currentIndexInQueue: () => {
        const { order, index } = get();
        return index >= 0 ? order[index] : -1;
      },

      playTracks: (tracks, startIndex = 0) => {
        const list = tracks.slice();
        if (list.length === 0) return;
        const start = Math.max(0, Math.min(startIndex, list.length - 1));
        const shuffle = get().shuffle;
        const order = shuffle ? shuffledOrder(list.length, start) : identityOrder(list.length);
        const newIndex = shuffle ? 0 : start;
        set({ queue: list, order, index: newIndex, isPlaying: true, currentTime: 0, pendingSeek: 0 });
      },

      playTrack: (track) => {
        // Replace queue with just this track.
        const shuffle = get().shuffle;
        set({
          queue: [track],
          order: [0],
          index: 0,
          isPlaying: true,
          currentTime: 0,
          pendingSeek: 0,
        });
        void shuffle;
      },

      addToQueue: (tracks) => {
        const { queue, order, shuffle } = get();
        if (tracks.length === 0) return;
        const startLen = queue.length;
        const nextQueue = [...queue, ...tracks];
        // New items always go to the very end of the play order.
        const appended = tracks.map((_, i) => startLen + i);
        let nextOrder = [...order, ...appended];
        if (shuffle && order.length > 0) {
          // If shuffling, reshuffle only the appended tail so existing order is stable.
          const head = order;
          const tail = appended;
          for (let i = tail.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tail[i], tail[j]] = [tail[j], tail[i]];
          }
          nextOrder = [...head, ...tail];
        }
        set({ queue: nextQueue, order: nextOrder });
      },

      playNext: (tracks) => {
        const { queue, order, index } = get();
        if (tracks.length === 0) return;
        if (index < 0 || order.length === 0) {
          get().playTracks(tracks);
          return;
        }
        const startLen = queue.length;
        const nextQueue = [...queue, ...tracks];
        // Insert new indices right after the current position in the play order.
        const insertAt = index + 1;
        const appended = tracks.map((_, i) => startLen + i);
        const nextOrder = [...order.slice(0, insertAt), ...appended, ...order.slice(insertAt)];
        set({ queue: nextQueue, order: nextOrder });
      },

      removeFromQueue: (position) => {
        const { queue, order, index } = get();
        if (position < 0 || position >= order.length) return;
        const removedQi = order[position];
        const nextQueue = queue.filter((_, i) => i !== removedQi);
        // Rebuild order: drop the removed position, and decrement any index that
        // pointed past the removed queue index.
        const nextOrder: number[] = [];
        for (let p = 0; p < order.length; p++) {
          if (p === position) continue;
          const qi = order[p];
          nextOrder.push(qi > removedQi ? qi - 1 : qi);
        }
        let nextIndex = index;
        if (position === index) nextIndex = Math.min(index, nextOrder.length - 1);
        else if (position < index) nextIndex = index - 1;
        set({ queue: nextQueue, order: nextOrder, index: nextIndex });
      },

      jumpTo: (position) => {
        const { order } = get();
        if (position < 0 || position >= order.length) return;
        set({ index: position, isPlaying: true, currentTime: 0, pendingSeek: 0 });
      },

      clearQueue: () => set({ queue: [], order: [], index: -1, isPlaying: false, currentTime: 0, duration: 0 }),

      togglePlay: () => {
        if (get().index < 0) return;
        set((s) => ({ isPlaying: !s.isPlaying }));
      },

      setPlaying: (playing) => set({ isPlaying: playing }),

      next: (auto = false) => {
        const { order, index, repeat } = get();
        if (order.length === 0) return;
        if (auto && repeat === 'one') {
          // Replay same track.
          set({ currentTime: 0, pendingSeek: 0, isPlaying: true });
          return;
        }
        let nextIndex = index + 1;
        if (nextIndex >= order.length) {
          if (repeat === 'all') nextIndex = 0;
          else {
            set({ isPlaying: false, currentTime: 0 });
            return;
          }
        }
        set({ index: nextIndex, currentTime: 0, pendingSeek: 0, isPlaying: true });
      },

      prev: () => {
        const { order, index, currentTime } = get();
        if (order.length === 0) return;
        // If more than 3s in, restart current track instead of jumping back.
        if (currentTime > 3) {
          set({ currentTime: 0, pendingSeek: 0 });
          return;
        }
        let prevIndex = index - 1;
        if (prevIndex < 0) prevIndex = 0;
        set({ index: prevIndex, currentTime: 0, pendingSeek: 0, isPlaying: true });
      },

      seek: (seconds) => set({ currentTime: seconds, pendingSeek: seconds }),
      seekBy: (delta) => {
        const { duration, currentTime } = get();
        const max = duration > 0 ? duration : Infinity;
        const next = Math.max(0, Math.min(max, currentTime + delta));
        set({ currentTime: next, pendingSeek: next });
      },
      setCurrentTime: (t) => set({ currentTime: t }),
      setDuration: (d) => set({ duration: d }),
      setPendingSeek: (t) => set({ pendingSeek: t }),

      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: Math.max(0, Math.min(1, v)) === 0 }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      setMuted: (m) => set({ muted: m }),

      toggleShuffle: () => {
        const { shuffle, queue, order, index } = get();
        const newShuffle = !shuffle;
        if (queue.length === 0) {
          set({ shuffle: newShuffle });
          return;
        }
        if (newShuffle) {
          const currentQi = index >= 0 ? order[index] : 0;
          const newOrder = shuffledOrder(queue.length, currentQi);
          set({ shuffle: true, order: newOrder, index: 0 });
        } else {
          const currentQi = index >= 0 ? order[index] : 0;
          set({ shuffle: false, order: identityOrder(queue.length), index: currentQi });
        }
      },

      cycleRepeat: () =>
        set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),
    }),
    {
      name: 'openmedia-player',
      // Persist prefs + the queue so the session resumes. We exclude transient
      // playback flags (isPlaying, currentTime, duration).
      partialize: (s) => ({
        queue: s.queue.slice(0, 500),
        order: s.order.slice(0, 500),
        index: s.index,
        volume: s.volume,
        muted: s.muted,
        shuffle: s.shuffle,
        repeat: s.repeat,
      }),
      // On rehydrate, never auto-resume playing — user must press play.
      onRehydrateStorage: () => (state) => {
        if (state) state.isPlaying = false;
      },
    },
  ),
);
