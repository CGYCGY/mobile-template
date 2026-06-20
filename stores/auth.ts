import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '@/lib/storage';

export type User = {
  id: string;
  email: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
};

type AuthState = {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (isLoading: boolean) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      // Start true: bootstrap always runs on cold start, so consumers (the tabs
      // gate, Convex's useAuth) should treat auth as pending until it resolves
      // instead of momentarily deciding the user is signed out.
      isLoading: true,
      setUser: (user) => set({ user }),
      setLoading: (isLoading) => set({ isLoading }),
      clear: () => set({ user: null, isLoading: false }),
    }),
    {
      name: 'mobile-template:auth',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (s) => ({ user: s.user }),
    },
  ),
);
