import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isHomeBackground, type HomeBackground } from '@/features/project/backgrounds/catalog';

interface HomeAppearanceState {
  background: HomeBackground;
  paused: boolean;
  setBackground: (background: HomeBackground) => void;
  togglePaused: () => void;
}

export const useHomeAppearanceStore = create<HomeAppearanceState>()(
  persist(
    (set) => ({
      background: 'assemble',
      paused: false,
      setBackground: (background) => set({ background }),
      togglePaused: () => set((state) => ({ paused: !state.paused })),
    }),
    {
      name: 'mvaigc-home-appearance',
      partialize: ({ background, paused }) => ({ background, paused }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<HomeAppearanceState> | null;
        return {
          ...current,
          background: isHomeBackground(saved?.background) ? saved.background : current.background,
          paused: typeof saved?.paused === 'boolean' ? saved.paused : current.paused,
        };
      },
    },
  ),
);
