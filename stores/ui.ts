import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '@/lib/storage';

export type Theme = 'system' | 'light' | 'dark';

type UIState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'mobile-template:ui',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
