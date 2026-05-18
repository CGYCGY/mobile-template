---
name: observability-posthog
description: PostHog wiring for this codebase - one SDK-managed instance via PostHogProvider, usePostHog() in consumers, manual posthog.screen() because autocapture is broken on Expo Router 6 / React Navigation 7, identify/reset on auth lifecycle, MMKV custom storage.
---

# Observability: PostHog

## Purpose

PostHog is the product analytics pipeline. There is exactly one PostHog instance per app session and the SDK owns it - the `<PostHogProvider>` at the root creates it, and every consumer reads it via `usePostHog()`. There is no standalone `posthog` instance file. Screen tracking is manual because autocapture's screen detection is broken on the Expo Router 6 / React Navigation 7 stack this codebase uses - the provider opts out with `captureScreens: false` and route layouts call `posthog.screen(name, props)` from an effect. Identify and reset are tied directly to the auth lifecycle so anonymous sessions never inherit the previous user's distinct_id.

## Patterns

### 1. Single SDK-managed instance via `<PostHogProvider>` at the root

The provider goes in `app/_layout.tsx`, above every other provider that might want to capture events.

```tsx
// app/_layout.tsx
import { PostHogProvider } from 'posthog-react-native';
import { env } from '@/env';
import { posthogStorage } from '@/lib/posthog';

function RootLayout() {
  return (
    <PostHogProvider
      apiKey={env.EXPO_PUBLIC_POSTHOG_KEY}
      options={{
        host: env.EXPO_PUBLIC_POSTHOG_HOST,
        captureAppLifecycleEvents: true,
        captureScreens: false,
        persistence: 'customStorage',
        customStorage: posthogStorage,
      }}
    >
      {/* TamaguiProvider, ConvexProvider, Stack ... */}
    </PostHogProvider>
  );
}

export default Sentry.wrap(RootLayout);
```

`captureAppLifecycleEvents` lives on `options`, not on `autocapture`. `captureScreens: false` is mandatory on Expo Router 6 / React Navigation 7 - the autocapture screen hook reads the legacy navigation tree and either no-ops or misnames screens.

### 2. Consumers read the instance via `usePostHog()`

App code never imports a `posthog` constant. It calls `usePostHog()` and guards on null (the hook returns `undefined` until the provider has mounted).

```tsx
// app/(tabs)/checkout.tsx
import { usePostHog } from 'posthog-react-native';

export default function CheckoutScreen() {
  const posthog = usePostHog();
  return (
    <Button onPress={() => posthog?.capture('checkout_started', { plan: 'pro' })} />
  );
}
```

### 3. Manual screen tracking via `posthog.screen(name)`

Each route fires `posthog.screen(name, props)` from an effect. The name is `verb_object` or PascalCase product-name - pick one convention across the codebase and stay consistent.

```tsx
// app/(tabs)/product/[id].tsx
import { useEffect } from 'react';
import { usePostHog } from 'posthog-react-native';
import { useLocalSearchParams } from 'expo-router';

export default function ProductScreen() {
  const posthog = usePostHog();
  const { id } = useLocalSearchParams<{ id: string }>();

  useEffect(() => {
    posthog?.screen('Product', { id });
  }, [posthog, id]);

  return /* ... */;
}
```

For shared shells, the easiest pattern is a tiny `useScreenTracking(name, props)` hook in `lib/` that wraps the effect.

### 4. `identify` after auth, `reset` on sign-out

Identify ties events to the stable user id - never the email. Reset on sign-out clears `distinct_id` so the next anonymous user is fresh.

```ts
// lib/auth/session.ts (sketch)
import type { PostHog } from 'posthog-react-native';

export async function onSignedIn(posthog: PostHog | undefined, user: { id: string; email: string }) {
  posthog?.identify(user.id, { email: user.email });
}

export async function onSignedOut(posthog: PostHog | undefined) {
  await posthog?.flush();
  posthog?.reset();
}
```

The call site lives in a component or hook where `usePostHog()` is available; the helpers stay pure.

### 5. MMKV custom storage adapter

The codebase already standardizes on MMKV (see `lib/storage`). Point PostHog at the same store so its event queue persists across cold starts without a second key-value backend. Both `persistence: 'customStorage'` and `customStorage: { getItem, setItem, removeItem }` are required - the SDK silently falls back to its default file persistence if `persistence` is missing.

```ts
// lib/posthog.ts (target shape)
import { storage } from '@/lib/storage';

export const posthogStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

export { PostHogProvider } from 'posthog-react-native';
```

## Anti-Patterns

- **Standalone `posthog` instance plus provider re-export (dual source of truth).** `lib/posthog.ts:4` constructs `new PostHog(env.EXPO_PUBLIC_POSTHOG_KEY, {...})` AND `lib/posthog.ts:27` re-exports `PostHogProvider`. That means the bundle has two PostHog instances at runtime - the one in `lib/posthog.ts` (used by the `track()` helper at `lib/posthog.ts:20`) and the one the provider creates internally. Events split between them, identify only applies to one, and `reset()` only clears one. Reconcile: delete the `new PostHog(...)` constructor and the `track()` helper, keep only the storage adapter and the `PostHogProvider` re-export, and migrate callers to `usePostHog()`.
- **`autocapture: true` in the provider props.** `lib/posthog.ts:17` sets `autocapture: true` in `postHogProviderProps`. On Expo Router 6 / React Navigation 7 this either no-ops or emits screen events with the wrong name. Replace with `options.captureScreens: false` and add manual `posthog.screen(...)` calls in route effects.
- **`captureAppLifecycleEvents` under `autocapture`.** This is a silent no-op - it belongs under `options`. The autocapture key namespace only knows `captureScreens`, `captureTouches`, `captureLifecycleEvents` (different key), `ignoreLabels`.
- **`identify(user.email)`.** Email changes (typo fixes, marriage) orphan the profile. Always identify by the stable auth id and pass email as a property.
- **Missing `reset()` on sign-out.** Next anonymous session inherits the previous distinct_id - events alias to the wrong user.
- **`capture()` immediately followed by `Updates.reloadAsync()` without `await posthog.flush()`.** RN batches events; an in-flight capture is dropped if the bundle reloads before the next flush window.

## Decision Rationale

See `../decisions.md` for:

- Why the SDK-managed instance is the single source of truth (no standalone `posthog` constant in `lib/`)
- Why `captureScreens: false` is mandatory on Expo Router 6 / React Navigation 7 and the manual `posthog.screen` pattern
- Why MMKV is the persistence backend instead of AsyncStorage
- Why `identify` lives in the auth session module instead of being sprinkled into route effects
