---
name: architecture
description: Layered architecture of this codebase — app/components/lib/stores/convex — with strict downward imports and per-layer responsibilities.
---

# Architecture

## Purpose

This codebase is layered. Routes consume UI components, UI consumes services and stores, services own integrations, stores own client state, and Convex owns the backend contract. Imports flow strictly downward — a lower layer must never reach into a higher one. Keeping that direction one-way is what lets a screen be deleted without ripple, and what lets `lib/` be unit-tested without mounting the navigator.

## Patterns

### Layer map

| Layer       | Responsibility                                                          | Cannot do                                                                  |
|-------------|-------------------------------------------------------------------------|----------------------------------------------------------------------------|
| `app/`      | File-based routes, `_layout.tsx` providers, auth gates, screen shells   | Hold reusable UI, talk to SDKs directly, define Zustand stores             |
| `components/` | Presentational + composite UI (Tamagui-based), icons, forms           | Import from `app/`, call Convex/network/SDKs directly                      |
| `lib/`      | Service adapters: auth, Convex client, storage, posthog, sentry, push   | Import from `app/`, `components/`, or `stores/`                            |
| `stores/`   | Zustand client state (auth user, UI theme), MMKV persistence            | Import from `app/` or `components/`; perform network I/O                   |
| `convex/`   | Backend functions, schemas, server-side auth glue                       | Import RN/Expo modules; depend on anything in `app/` `components/` `lib/`  |

Direction of allowed imports: `app/` -> `components/` -> `lib/` -> `stores/`, and any of those four may import the generated `convex/_generated/api` types. Reverse imports are forbidden.

### Path alias

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

All cross-layer imports use the `@/` alias; relative `../../` chains are reserved for intra-layer siblings.

### Route layer — composes lower layers, never holds logic

```tsx
// app/(tabs)/settings.tsx
import { signOut } from '@/lib/auth';
import { type Theme, useAuthStore, useUIStore } from '@/stores';
import { Button } from '@/components/ui/Button';
```

A screen imports a service (`lib/auth`), state (`stores`), and UI (`components/ui`). It does not import `expo-secure-store` or `convex/react` directly when an adapter exists for it.

### Store layer — persisted client state only

```ts
// stores/auth.ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from '@/lib/storage';

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: false,
      setUser: (user) => set({ user }),
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

`partialize` persists only `user`. Tokens never enter the store — they live in `lib/auth/tokens.ts` backed by `expo-secure-store`. The store imports `mmkvStorage` from `lib/`, never the other way around.

### Service layer — SDK boundary

```ts
// lib/notifications/setup.ts
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export function configureNotifications(): void {
  // wraps expo-notifications so screens never call it directly
}
```

If a screen needs notifications, it calls `configureNotifications()` from `@/lib/notifications`, not `expo-notifications` directly. Same rule for `expo-secure-store`, `convex/react` client construction, WorkOS, PostHog, Sentry.

### Convex layer — typed contract

```ts
// app/(tabs)/index.tsx
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
```

Screens consume queries via the generated `api`. The `convex/` folder is excluded from the app TS project (`tsconfig.json` `exclude`) and has its own `convex/tsconfig.json` — preserving the one-way contract.

## Anti-Patterns

None currently in this codebase. When auditing future changes, flag:

- `lib/**` files importing from `@/components` or `@/app`
- `components/**` files importing from `@/app`
- `stores/**` files calling `fetch`, `convex/react`, or any SDK other than the storage adapter
- Direct `expo-secure-store` / `convex/react` / WorkOS SDK imports in `app/` when an adapter exists in `lib/`

## Decision Rationale

See `decisions.md` for:

- Why `useAuthStore` persists `user` only and tokens go to SecureStore
- Why the Convex folder has its own tsconfig and is excluded from the app project
- Why providers wrap in `app/_layout.tsx` (route layer) rather than `lib/` (service layer)
