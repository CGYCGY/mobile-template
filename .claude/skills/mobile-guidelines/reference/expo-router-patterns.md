---
name: expo-router-patterns
description: Expo Router v6 conventions used in this codebase — group segments, nested layouts, Redirect-based auth gates, typed routes, and navigation rules.
---

# Expo Router Patterns

## Purpose

This codebase uses Expo Router v6 with `typedRoutes` enabled and the New Architecture. Routes are files, layouts are `_layout.tsx`, and the navigator is configured declaratively. The patterns below are not stylistic — they prevent the two classes of bugs Expo Router most often produces: render-time navigation loops and stringly-typed hrefs that drift from the route tree.

## Patterns

### Group segments + nested layouts

`(auth)` and `(tabs)` are layout groups: parentheses make them invisible in the URL but give them their own `_layout.tsx`. The root layout registers them by name:

```tsx
// app/_layout.tsx
<Stack screenOptions={{ headerShown: false }}>
  <Stack.Screen name="(auth)" />
  <Stack.Screen name="(tabs)" />
  <Stack.Screen name="auth/callback" />
  <Stack.Screen name="+not-found" />
</Stack>
```

`Stack.Screen` lives in the parent layout, not the child screen — options declared in a screen file are silently ignored by Expo Router.

### Auth gate with `<Redirect>` (locked decision)

The gate is rendered, not imperative. Each group layout reads the auth store and returns a `<Redirect>` when the precondition fails:

```tsx
// app/(tabs)/_layout.tsx
import { Redirect, Tabs } from 'expo-router';
import { useAuthStore } from '@/stores';

export default function TabsLayout() {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Tabs screenOptions={{ headerShown: false }}>{/* ... */}</Tabs>;
}
```

```tsx
// app/(auth)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/stores';

export default function AuthLayout() {
  const user = useAuthStore((s) => s.user);

  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`<Redirect>` is render-safe. `router.replace` is not — calling it during render schedules a navigation on every render and produces a loop.

### When `router.replace` IS allowed

Only inside effects and event handlers, never in the render body. The OAuth callback is the only place in this codebase that uses it, and it does so from a `useEffect`:

```tsx
// app/auth/callback.tsx
useEffect(() => {
  let cancelled = false;
  async function run() {
    try {
      await completeSignIn({ code: params.code, state: params.state });
      if (!cancelled) router.replace('/(tabs)');
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    }
  }
  run();
  return () => {
    cancelled = true;
  };
}, [params.code, params.state]);
```

The `cancelled` flag prevents a navigation fired after unmount. This is the canonical shape — copy it when you add another async-completion screen.

### Typed search params

```tsx
// app/auth/callback.tsx
import { useLocalSearchParams } from 'expo-router';

const params = useLocalSearchParams<{ code?: string; state?: string }>();
```

Always supply the generic. With `noUncheckedIndexedAccess` on, this is the only way to keep `params.code` as `string | undefined` rather than a wider type. Do not call `useLocalSearchParams` in a `_layout.tsx` — it re-runs on every nested route change.

### `typedRoutes` — do not stringify hrefs manually

```ts
// app.config.ts
experiments: {
  typedRoutes: true,
}
```

With this on, `<Link href="...">` and `router.push("...")` are typechecked against the actual route tree. Concrete consequences:

- Pass route paths as string literals, not as variables built from `\`/${segment}\``.
- For dynamic routes, prefer the object form: `router.push({ pathname: '/items/[id]', params: { id } })`. Never `JSON.stringify` a complex object into a param — pass an id, refetch from the store or Convex.

### `<Link>` in JSX, `router.push` in handlers

```tsx
// app/+not-found.tsx
import { Link, Stack } from 'expo-router';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <YStack /* ... */>
        <H1>Screen not found</H1>
        <Link href="/">Go home</Link>
      </YStack>
    </>
  );
}
```

Use `<Link>` when the navigation is rendered as a tappable element — it gives accessibility, prefetch, and right-click semantics for free. Use `router.push` / `router.replace` only inside event handlers and effects.

### Deep linking — scheme is the entry point

```ts
// app.config.ts
const config: ExpoConfig = {
  name: 'Mobile Template',
  slug: 'mobile-template',
  scheme: 'mobiletemplate',
  // ...
};
```

`scheme` becomes the URL prefix (`mobiletemplate://auth/callback`). Any file under `app/` is automatically reachable by its path — `app/auth/callback.tsx` is the OAuth landing route. Do not register additional schemes ad-hoc; add them here so `expo-linking` and EAS share one source of truth.

## Anti-Patterns

None currently in this codebase. When reviewing changes, flag:

- `router.push` or `router.replace` called in a component's render body (allowed only inside `useEffect` or handlers)
- `useLocalSearchParams` inside any `_layout.tsx`
- `<Stack.Screen options={...} />` declared inside a screen file rather than its parent layout
- Hrefs built from template strings or `JSON.stringify(obj)` in params
- New schemes registered outside `app.config.ts`

## Decision Rationale

See `decisions.md` for:

- Why auth gating uses `<Redirect>` in layouts rather than a global guard component or `router.replace` in an effect
- Why `auth/callback` lives at the root, not inside `(auth)`
- Why `typedRoutes` is opted into despite the build-time cost
