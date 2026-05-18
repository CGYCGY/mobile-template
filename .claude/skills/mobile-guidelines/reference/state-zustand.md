---
name: state-zustand
description: Zustand v5 store patterns in this codebase — typed `create<T>()`, MMKV-backed `persist` with `partialize`, versioned migrations, and selector-based consumption. Tokens never live in Zustand.
---

# Zustand State

## Purpose

Zustand is the client state container in this codebase. Stores own ephemeral, UI-shaped state (current user identity, theme preference) and never own secrets, server caches, or derived data. Persistence flows through the MMKV adapter from `lib/storage/mmkv.ts` so reads are synchronous in render paths. Every persisted slice is opt-in via `partialize`, and any change in slice shape gets a `version` bump and a `migrate` function — otherwise users on the old shape silently land in a broken state after an app update.

The rule that matters most: tokens, refresh tokens, PKCE values, and anything else SecureStore-class **never enter a Zustand store**. Zustand state ends up serialized in MMKV (unencrypted on most installs), so putting a JWT there is the same as `console.log`-ing it to disk. Token storage belongs in `lib/storage/secure.ts` and is mediated by `lib/auth/tokens.ts`.

## Patterns

### Typed `create<T>()` with `persist` + MMKV adapter

```ts
// stores/auth.ts
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
      isLoading: false,
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
```

Note the call shape: `create<AuthState>()(persist(...))` — the curried form preserves inference through middleware. `partialize` keeps `isLoading` (a transient flag) out of MMKV. The persisted slice is `{ user }` and nothing else.

### Minimal persisted slice (or none at all)

```ts
// stores/ui.ts
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
```

For small stores where every field is meant to persist, omit `partialize`. The rule isn't "always partialize" — it's "never persist a transient or sensitive field." When in doubt, opt in explicitly.

### Versioned migrations when shape changes

```ts
// when AuthState gains/loses a persisted field, bump version + provide migrate
persist(
  (set) => ({ /* ... */ }),
  {
    name: 'mobile-template:auth',
    storage: createJSONStorage(() => mmkvStorage),
    partialize: (s) => ({ user: s.user }),
    version: 2,
    migrate: (persisted, fromVersion) => {
      if (fromVersion < 2) {
        // v1 stored { user: { id, email } }, v2 adds displayName/avatarUrl as optional
        const old = persisted as { user: { id: string; email: string } | null };
        return { user: old.user ? { ...old.user, name: old.user.email } : null };
      }
      return persisted as Partial<AuthState>;
    },
  },
)
```

Without `migrate`, a v1-shaped object hydrates into a v2 store with missing required fields. The component reading `user.name` then renders `undefined`.

### Selectors over object destructuring

```ts
// app/(tabs)/_layout.tsx
const user = useAuthStore((s) => s.user);
```

```ts
// app/(auth)/_layout.tsx
const user = useAuthStore((s) => s.user);
```

```tsx
// inside a component that needs both reads and an action
const user = useAuthStore((s) => s.user);
const clear = useAuthStore((s) => s.clear);
```

One selector per field. Avoid `const { user, clear } = useAuthStore()` — that subscribes the component to **every** store change, so a `setLoading(true)` during sign-in re-renders the screen even though it only cares about `user`.

For derived arrays/objects (not present today, but the rule applies as the codebase grows), pair the selector with `shallow`:

```ts
import { shallow } from 'zustand/shallow';
const items = useStore((s) => s.items.filter((i) => i.active), shallow);
```

### Mutating from outside React (auth flow)

```ts
// lib/auth/index.ts
const { setUser, setLoading } = useAuthStore.getState();
setLoading(true);
// ...
setUser(user);
```

`useAuthStore.getState()` is the way to call actions from non-React code (`lib/auth/index.ts`, callback handlers, push notification handlers). Don't reach for `useState` mirrors of store fields — the store *is* the source of truth.

## Anti-Patterns

- Putting tokens, refresh tokens, or PKCE values into any Zustand store. The MMKV-backed persist layer would serialize them to disk in cleartext. See `lib/auth/tokens.ts` and `storage-and-crypto.md` for the SecureStore-mediated alternative.
- Destructuring the whole store: `const { user, isLoading } = useAuthStore()` — subscribes to every field, defeats the per-selector render model.
- Storing derived data (e.g. `userIsAdmin: user?.role === 'admin'`) as a field. Compute it in the selector or at the call site so it can never desync.
- Calling `set()` multiple times in one action — each call schedules a render. Batch into a single `set({ a, b })`.
- Persisting transient flags. `partialize: (s) => ({ user: s.user })` in `stores/auth.ts:33` is the canonical example: `isLoading` is intentionally **not** in the persisted slice.
- Changing the persisted shape without bumping `version`. Users updating the app from the previous shape will hydrate a partial object and crash at the first property access.

## Decision Rationale

See `../decisions.md` for the reasoning behind the SecureStore/MMKV split, why `useAuthStore` persists `user` only, and why the MMKV adapter (not AsyncStorage) backs every `persist` in this codebase.
