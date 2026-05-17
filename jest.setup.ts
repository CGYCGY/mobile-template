import '@testing-library/jest-native/extend-expect';

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string | number | boolean>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      set: (key: string, value: string | number | boolean) => store.set(key, value),
      getString: (key: string) => store.get(key) as string | undefined,
      getNumber: (key: string) => store.get(key) as number | undefined,
      getBoolean: (key: string) => store.get(key) as boolean | undefined,
      contains: (key: string) => store.has(key),
      delete: (key: string) => store.delete(key),
      clearAll: () => store.clear(),
      getAllKeys: () => Array.from(store.keys()),
    })),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
  Tabs: { Screen: () => null },
  Redirect: () => null,
}));
