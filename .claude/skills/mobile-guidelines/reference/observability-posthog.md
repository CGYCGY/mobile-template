---
name: observability-posthog
description: PostHog wiring for this codebase - one SDK-managed instance via PostHogProvider, usePostHog() in consumers, the PostHogInstrumentation component for manual screen()/identify()/reset() driven by usePathname and the auth store, captureScreens false for control.
---

# Observability: PostHog

## Purpose

PostHog is the product analytics pipeline. There is exactly one PostHog instance per app session and the SDK owns it - the `<PostHogProvider>` at the root creates it (props in `postHogProviderProps`, `lib/posthog.ts`), and every consumer reads it via `usePostHog()`. There is no standalone `posthog` instance file. Screen, identify, and reset are centralized in a single `PostHogInstrumentation` component mounted inside the provider: it fires `posthog.screen(pathname)` on every route change (via `usePathname`), `posthog.identify(user.id)` on sign-in, and `posthog.reset()` on sign-out. `captureScreens` is **false** by choice — screen tracking is done manually via `usePathname` for control over event names. Identify/reset are tied to the auth store so anonymous sessions never inherit the previous user's distinct_id (the bleed problem on a shared device).

## Patterns

### 1. Single SDK-managed instance via `<PostHogProvider>` at the root

The provider props live in `lib/posthog.ts` as `postHogProviderProps`; `app/_layout.tsx` spreads them onto `<PostHogProvider>`, above every other provider that might want to capture events.

```ts
// lib/posthog.ts
export const postHogProviderProps = {
  apiKey: env.EXPO_PUBLIC_POSTHOG_KEY,
  options: {
    host: env.EXPO_PUBLIC_POSTHOG_HOST,
    captureAppLifecycleEvents: true,
    captureScreens: false,
  },
} as const;
```

```tsx
// app/_layout.tsx
<PostHogProvider {...postHogProviderProps}>
  <PostHogInstrumentation />
  {/* TamaguiProvider, ConvexProviderWithAuth, Stack ... */}
</PostHogProvider>
```

`captureAppLifecycleEvents` lives on `options`, not on `autocapture`. `captureScreens` is **false** by choice: screens are tracked manually through `PostHogInstrumentation` (below) so the event name is a controlled value (`usePathname()`), not whatever autocapture infers.

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

### 3. `PostHogInstrumentation` — screen + identify + reset in one component

Screen tracking, identify, and reset are not sprinkled across route effects — they live in one component mounted inside the provider. It reads `usePathname()` for the route and `useAuthStore((s) => s.user)` for identity.

```tsx
// lib/posthog.ts
export function PostHogInstrumentation() {
  const posthog = usePostHog();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    if (pathname) posthog.screen(pathname);
  }, [posthog, pathname]);

  useEffect(() => {
    if (user) {
      if (identifiedId.current !== user.id) {
        posthog.identify(user.id, { email: user.email });
        identifiedId.current = user.id;
      }
    } else if (identifiedId.current !== null) {
      posthog.reset();
      identifiedId.current = null;
    }
  }, [posthog, user]);

  return null;
}
```

The `identifiedId` ref makes both effects idempotent — `identify` fires once per distinct user id, and `reset` fires once on the sign-in → sign-out transition (not on every `user`-null render). Mount it exactly once, as a child of `<PostHogProvider>`.

### 4. Identity rules: id not email, always reset on sign-out

`identify` ties events to the **stable user id**; email is passed only as a property because emails change (typo fixes, marriage) and would orphan the profile. `reset` on sign-out clears `distinct_id` — without it, the next anonymous user on a shared device inherits the previous user's id and their events alias to the wrong person. Both rules are already enforced by the `PostHogInstrumentation` effects above; ad-hoc `identify`/`reset` calls elsewhere are unnecessary and risk drift.

### 5. Ad-hoc events via `usePostHog()`

Non-screen product events are captured directly from a component with `usePostHog()` — there is no standalone `posthog` constant to import and no custom MMKV storage adapter; the SDK manages its own persistence.

```tsx
const posthog = usePostHog();
<Button onPress={() => posthog?.capture('checkout_started', { plan: 'pro' })} />
```

## Anti-Patterns

- **Standalone `posthog` instance in `lib/`.** Do not `new PostHog(...)` in a `lib/` file alongside the provider — that creates two instances at runtime, splits events, and means `identify`/`reset` only apply to one. The provider-created instance reached via `usePostHog()` (and the `PostHogInstrumentation` component) is the single source of truth.
- **Re-implementing screen/identify/reset in route effects.** That logic lives in `PostHogInstrumentation`. Duplicating it double-fires `screen()` and races the identify ref.
- **`autocapture`-based screen tracking.** `captureScreens` is intentionally `false`; screens come from `usePathname()` in `PostHogInstrumentation`. Do not flip `captureScreens: true` or add an `autocapture` block.
- **`captureAppLifecycleEvents` under `autocapture`.** It belongs under `options` (as in `postHogProviderProps`). Nested under `autocapture` it is a silent no-op.
- **`identify(user.email)`.** Always identify by the stable auth id and pass email as a property.
- **Missing `reset()` on sign-out.** Next anonymous session inherits the previous distinct_id — events alias to the wrong user. (Handled by the component; don't bypass it.)
- **`capture()` immediately followed by `Updates.reloadAsync()` without `await posthog.flush()`.** RN batches events; an in-flight capture is dropped if the bundle reloads before the next flush window.

## Decision Rationale

See `../decisions.md` for:

- Why the SDK-managed instance is the single source of truth (no standalone `posthog` constant in `lib/`)
- Why `captureScreens: false` plus the `PostHogInstrumentation` (`usePathname`-driven) pattern is preferred for controlled screen names
- Why identify/reset are centralized in one component wired to the auth store rather than sprinkled into route effects
