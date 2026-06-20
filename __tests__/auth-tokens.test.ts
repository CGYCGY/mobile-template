// In-memory SecureStore so the split-key token lifecycle (save -> read -> clear)
// is exercised end to end. Overrides the null-returning stub from jest.setup.ts.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlocked',
}));

import {
  type AuthTokens,
  clearTokens,
  getTokens,
  saveTokens,
} from '@/lib/auth/tokens';

const sample: AuthTokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  idToken: 'id-1',
  expiresAt: 1_900_000_000_000,
  user: { id: 'u1', email: 'a@b.co' },
};

beforeEach(() => {
  mockStore.clear();
});

describe('token persistence', () => {
  it('round-trips a saved token bundle', async () => {
    await saveTokens(sample);
    expect(await getTokens()).toEqual(sample);
  });

  it('returns null when nothing is stored', async () => {
    expect(await getTokens()).toBeNull();
  });

  it('splits the bundle across keys (never one oversized entry)', async () => {
    await saveTokens(sample);
    // The single combined key must not exist; a >2048-byte write to it could
    // fail silently, which is exactly why the bundle is split.
    expect(mockStore.has('mobile-template:auth-tokens')).toBe(false);
    expect(mockStore.get('mobile-template:auth-access-token')).toBe('access-1');
    expect(mockStore.get('mobile-template:auth-refresh-token')).toBe(
      'refresh-1',
    );
    expect(mockStore.get('mobile-template:auth-id-token')).toBe('id-1');
  });

  it('keeps expiresAt and user together in the meta entry', async () => {
    await saveTokens(sample);
    const meta = JSON.parse(
      mockStore.get('mobile-template:auth-meta') as string,
    );
    expect(meta).toEqual({ expiresAt: sample.expiresAt, user: sample.user });
  });

  it('drops the id-token key when none is provided', async () => {
    await saveTokens({ ...sample, idToken: undefined });
    expect(mockStore.has('mobile-template:auth-id-token')).toBe(false);
    const got = await getTokens();
    expect(got?.idToken).toBeUndefined();
  });

  it('returns null when the meta entry is missing', async () => {
    mockStore.set('mobile-template:auth-access-token', 'access-1');
    mockStore.set('mobile-template:auth-refresh-token', 'refresh-1');
    expect(await getTokens()).toBeNull();
  });

  it('clears every key', async () => {
    await saveTokens(sample);
    await clearTokens();
    expect(mockStore.size).toBe(0);
    expect(await getTokens()).toBeNull();
  });
});

describe('test harness', () => {
  it('resolves the @/ path alias', () => {
    // require (not dynamic import) so jest's CJS transform resolves the alias
    // without needing Node's --experimental-vm-modules flag.
    const mod = require('@/lib/storage');
    expect(mod).toBeDefined();
  });
});
