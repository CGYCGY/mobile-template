import { MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

export const storage = new MMKV({ id: 'mobile-template' });

export const mmkvStorage: StateStorage = {
  getItem: (name) => {
    const value = storage.getString(name);
    return value ?? null;
  },
  setItem: (name, value) => {
    storage.set(name, value);
  },
  removeItem: (name) => {
    storage.delete(name);
  },
};
