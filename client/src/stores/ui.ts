import { create } from 'zustand';

interface UIState {
  queueOpen: boolean;
  paletteOpen: boolean;
  setQueueOpen: (open: boolean) => void;
  toggleQueue: () => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

export const useUI = create<UIState>((set) => ({
  queueOpen: false,
  paletteOpen: false,
  setQueueOpen: (open) => set({ queueOpen: open }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
