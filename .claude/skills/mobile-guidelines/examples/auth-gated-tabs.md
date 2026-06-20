---
name: example-auth-gated-tabs
description: Annotated walkthrough of how (auth) and (tabs) layouts gate access via Redirect — the canonical auth boundary in this codebase.
---

# Example: Auth-Gated Tabs

Auth gating uses two **mirror-image** layouts:

- `(auth)/_layout.tsx` — if signed in, redirect to `(tabs)`.
- `(tabs)/_layout.tsx` — if not signed in, redirect to `(auth)/sign-in`.

This pattern avoids any `router.replace` in render, which would warn and re-render loop. Use `<Redirect>` instead — it's purpose-built.

## The two layouts

```tsx
// app/(auth)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/stores';

export default function AuthLayout() {
  const user = useAuthStore((s) => s.user);
  if (user) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

```tsx
// app/(tabs)/_layout.tsx
import { Redirect, Tabs } from 'expo-router';
import { Home, Settings } from '@/components/icons';
import { useAuthStore } from '@/stores';

export default function TabsLayout() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

## Patterns demonstrated

- ✓ **Single source of truth for auth state** — both layouts read `useAuthStore((s) => s.user)`. No prop drilling, no context.
- ✓ **`<Redirect>` instead of `router.replace`** in render.
- ✓ **Selector form of Zustand** — `useAuthStore((s) => s.user)` avoids re-renders when other store slices change.
- ✓ **Icons routed via `@/components/icons`** — never imported directly from `lucide-react-native`. Keeps the import surface swappable.

## What these layouts do NOT need

- 🚫 **No Convex token-injection hook here.** Earlier guidance had you call `useConvexAuthBridge()` at the top of `TabsLayout`. That hook is **gone**: Convex auth is now driven by the root `ConvexProviderWithAuth` + `useAuth()` in `app/_layout.tsx`, which fetches a token only once `isAuthenticated` is true. An authenticated query/mutation already sees a non-null `ctx.auth.getUserIdentity()` without any per-layout wiring. Do not add a bridge here. See `decisions.md` → "Convex auth: root-mounted `ConvexProviderWithAuth`".
- 🚫 **No `posthog.screen()` calls here.** Screen tracking is handled once by `<PostHogInstrumentation/>` at the root (driven by `usePathname`); per-screen calls would double-fire. See `reference/observability-posthog.md`.

These layouts therefore stay minimal — just the `<Redirect>` gate and the navigator.

## Anti-patterns to avoid

- ❌ Re-adding a Convex bridge or `convexClient.setAuth(...)` call to a layout. Root `ConvexProviderWithAuth` already owns token fetch; a second driver double-drives the client.
- ❌ `router.replace('/(auth)/sign-in')` inside the component body or a `useEffect` that runs every render. Use `<Redirect>` for declarative redirects; only use `router.replace` from event handlers (e.g., after a sign-out button press).
- ❌ Reading multiple store slices at once (`const { user, theme } = useAuthStore()`) — causes unnecessary re-renders. Use one selector per slice.
