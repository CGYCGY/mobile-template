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

## What's missing (and should be added by downstream projects)

- 🔧 **`useConvexAuthBridge()` should be called at the top of `TabsLayout`** (or any post-auth root). It pushes the WorkOS access token into the Convex client; without it, every authenticated Convex query/mutation will see `ctx.auth.getUserIdentity() === null`.

  ```tsx
  // app/(tabs)/_layout.tsx — recommended addition
  export default function TabsLayout() {
    useConvexAuthBridge();          // ← add this
    const user = useAuthStore((s) => s.user);
    if (!user) return <Redirect href="/(auth)/sign-in" />;
    // ...
  }
  ```

  See `decisions.md` → "Convex useConvexAuthBridge mount point".

- 🔧 **`posthog.screen()` calls** for manual screen tracking (since `captureScreens: false`). Add inside route-level `useEffect` or in each tab screen.

## Anti-patterns to avoid

- ❌ `router.replace('/(auth)/sign-in')` inside the component body or a `useEffect` that runs every render. Use `<Redirect>` for declarative redirects; only use `router.replace` from event handlers (e.g., after a sign-out button press).
- ❌ Reading multiple store slices at once (`const { user, theme } = useAuthStore()`) — causes unnecessary re-renders. Use one selector per slice.
