---
name: storage-and-crypto
description: Storage and crypto primitives for this codebase — SecureStore for secrets, MMKV for prefs and Zustand persistence, react-native-quick-crypto for PKCE and random bytes. Wrong choice is a security or perf bug, not a style issue.
---

# Storage & Crypto

## Purpose

Three primitives, three jobs. Auth tokens and other SecureStore-class secrets live in the iOS Keychain / Android Keystore via `expo-secure-store`. User preferences, Zustand persistence, and cached non-sensitive data live in MMKV (v4, JSI-backed via `react-native-nitro-modules`) through a module-load singleton. Cryptographic primitives — PKCE verifiers, random `state` values, hashing in hot paths — come from `react-native-quick-crypto` (v1), which is sync and free of bridge overhead. `Math.random()` is never acceptable for security-relevant values; `AsyncStorage` is never used in new code.

The `Math.random()` rule is enforced in `lib/auth/` today: both the PKCE verifier (`pkce.ts`) and the OAuth `state` (`workos.ts` → `cryptoRandomState()`) come from `QuickCrypto.randomBytes(...)`.

## Patterns

### Decision matrix

| Data class | Use | Why |
|---|---|---|
| Auth access token, refresh token, id token | `expo-secure-store` via `lib/storage/secure.ts` and `lib/auth/tokens.ts` | Hardware-backed Keychain / Keystore |
| PKCE verifier and state (during the auth round-trip) | `expo-secure-store` via `lib/storage/secure.ts` | They unlock a token exchange; treat as secrets |
| Encryption keys, signing keys | `expo-secure-store` | Same |
| Zustand persist state (`user`, `theme`, ...) | `mmkvStorage` adapter from `lib/storage/mmkv.ts` | Sync API matches Zustand's sync model |
| Theme, locale, onboarding flags | MMKV via `storage` singleton | Sync reads in render paths |
| Cached query responses, draft forms | MMKV | MMKV handles up to ~MBs cheaply |
| Large blobs (images, downloads, >10 MB) | `expo-file-system` | Filesystem, not key-value |

| Crypto need | Use | Why |
|---|---|---|
| PKCE verifier / state random bytes | `QuickCrypto.randomBytes(n)` | Sync, JSI; called in the auth hot path |
| PKCE challenge (SHA-256 of verifier) | `QuickCrypto.createHash('sha256')` | Sync, JSI |
| Random UUIDs for non-security IDs (analytics correlation, log keys) | `expo-crypto.randomUUID()` | Simpler API where sync isn't required |
| Anything labeled "random" in a security context | `react-native-quick-crypto` | Never `Math.random()` |

### MMKV singleton + Zustand adapter

```ts
// lib/storage/mmkv.ts
import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

// MMKV v4: instances come from the createMMKV() factory (v3 was `new MMKV()`),
// and it's nitro-backed (requires react-native-nitro-modules).
export const storage = createMMKV({ id: 'mobile-template' });

export const mmkvStorage: StateStorage = {
  getItem: (name) => {
    const value = storage.getString(name);
    return value ?? null;
  },
  setItem: (name, value) => {
    storage.set(name, value);
  },
  removeItem: (name) => {
    storage.remove(name); // v4 renamed v3's `delete` to `remove`
  },
};
```

One MMKV instance per app, created at module load. The `id` is namespaced so a downstream fork that ships alongside the original won't collide. The `mmkvStorage` adapter is what every Zustand `persist({ storage: createJSONStorage(() => mmkvStorage) })` call wires up. MMKV is sync — never `await` a read.

### SecureStore helpers

```ts
// lib/storage/secure.ts
import * as SecureStore from 'expo-secure-store';

type SecureOptions = {
  keychainAccessible?: SecureStore.KeychainAccessibilityConstant;
  requireAuthentication?: boolean;
};

const DEFAULT_OPTIONS: SecureOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function secureSet(
  key: string,
  value: string,
  opts?: SecureOptions,
): Promise<void> {
  await SecureStore.setItemAsync(key, value, { ...DEFAULT_OPTIONS, ...opts });
}

export async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
```

`WHEN_UNLOCKED_THIS_DEVICE_ONLY` means the keychain item is unreadable while the device is locked and never syncs to iCloud / restores to a different device. That's the right default for an access token. Routes never call SecureStore directly — they go through `lib/auth/tokens.ts` so the key name stays in one place.

### Crypto via react-native-quick-crypto (PKCE)

```ts
// lib/auth/pkce.ts
import QuickCrypto from 'react-native-quick-crypto';

export async function generatePkcePair(): Promise<PkcePair> {
  const randomBytes = QuickCrypto.randomBytes(48);
  const verifier = base64UrlEncode(randomBytes);

  const hash = QuickCrypto.createHash('sha256');
  hash.update(verifier);
  const digest = hash.digest();
  const challenge = base64UrlEncode(digest);

  return { verifier, challenge };
}
```

`QuickCrypto.randomBytes` and `createHash` are sync JSI calls — no event-loop yield, no bridge round-trip. That matters when sign-in is one tap and the user is staring at the spinner.

The same primitive must be used for the OAuth `state` parameter — see `auth-workos-pkce.md`. Per the locked decision, `state` is `QuickCrypto.randomBytes(16).toString('hex')`.

## Anti-Patterns

- Building the OAuth `state` from `Math.random().toString(36)` (or any non-crypto PRNG). `cryptoRandomState()` in `lib/auth/workos.ts` correctly uses `QuickCrypto.randomBytes(16)` today; reverting it to `Math.random()` would let an attacker predict the value and forge a callback that passes the CSRF check.
- Putting a JWT or refresh token into MMKV (or `AsyncStorage`, or Zustand persist). MMKV stores cleartext on disk by default. Tokens go through `lib/auth/tokens.ts` → SecureStore only.
- `AsyncStorage` anywhere in new code. It's an async bridge call per read; MMKV is sync via JSI. Existing dependencies on `@react-native-async-storage/async-storage` should be migrated.
- `await storage.getString(key)` — MMKV is sync; the `await` resolves a non-thenable and returns `undefined` on the next tick, which is almost always a bug.
- Stuffing >2 KB into a single SecureStore key. `expo-secure-store` has a ~2048-byte per-item limit and an over-limit write can fail **silently** — leaving a stale or half-written entry. This is exactly why `lib/auth/tokens.ts` splits access / refresh / id / meta across separate keys instead of one JSON blob (two JWTs + the user payload blow past the limit). Large profile/cache data goes to MMKV (or remote), never one fat SecureStore key.
- Recreating `createMMKV()` per call instead of importing the `storage` singleton from `lib/storage/mmkv.ts`. Cheap but wasteful and breaks the single-namespace assumption. (Also: it's `createMMKV()` in v4, not `new MMKV()`.)
- Reaching for `expo-crypto` in the PKCE path. The codebase already depends on `react-native-quick-crypto`; its sync API is the right choice on the auth hot path. Reserve `expo-crypto` for cases where async fits naturally (e.g. one-shot `digestStringAsync` outside a render).
- Storing an object in MMKV without serializing: `storage.set('user', { id: '1' })` writes the string `"[object Object]"`. Use `JSON.stringify` / `JSON.parse`, or go through the Zustand `mmkvStorage` adapter which handles it via `createJSONStorage`.

## Decision Rationale

See `../decisions.md` for the reasoning behind the SecureStore-vs-MMKV split, why `react-native-quick-crypto` is the crypto primitive in `lib/auth/`, and why `AsyncStorage` is excluded from new code in this codebase.
