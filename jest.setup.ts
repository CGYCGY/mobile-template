require('react-native-gesture-handler/jestSetup');

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children?: unknown }) => children,
    SafeAreaView: View,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});

jest.mock('react-native-worklets', () => ({
  runOnJS:
    <T>(fn: T) =>
    () =>
      fn,
  runOnUI:
    <T>(fn: T) =>
    () =>
      fn,
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const createAnimatedComponent = <T>(component: T) => component;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent },
    createAnimatedComponent,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    cancelAnimation: () => {},
  };
});

// MMKV v4 exposes a `createMMKV` factory (v3 was `new MMKV()`); the mock mirrors
// the v4 instance shape, including `remove` (renamed from v3's `delete`).
jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string | number | boolean>();
  return {
    createMMKV: jest.fn(() => ({
      set: (key: string, value: string | number | boolean) =>
        store.set(key, value),
      getString: (key: string) => store.get(key) as string | undefined,
      getNumber: (key: string) => store.get(key) as number | undefined,
      getBoolean: (key: string) => store.get(key) as boolean | undefined,
      contains: (key: string) => store.has(key),
      remove: (key: string) => store.delete(key),
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
