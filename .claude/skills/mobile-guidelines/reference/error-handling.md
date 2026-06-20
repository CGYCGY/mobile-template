---
name: error-handling
description: Error handling and logging conventions for this codebase — lib/log.ts as the single logging surface, mandatory Sentry capture in catch blocks, RootErrorBoundary as the outermost provider, no silent catches.
---

# Error Handling

## Purpose

Every error that reaches a user — a thrown query, a render-time TypeError, a rejected promise from a button handler — must either surface in Sentry with a stack trace, or be deliberately and visibly swallowed with a `// ignore: <reason>` comment. There is no middle ground. The two mechanisms that enforce this are `lib/log.ts` (the only logging surface app code should use) and `RootErrorBoundary` in `app/_layout.tsx` (the outermost provider, so render errors anywhere in the tree are caught and reported). Together they turn "production crashed for one user" into a triageable Sentry issue instead of a blank screen.

## Patterns

### 1. `lib/log.ts` is the single logging surface

`console.*` writes are gated by Biome's `lint/suspicious/noConsole` rule. The one allow-listed surface is `lib/log.ts`, which wraps every level with a Sentry breadcrumb (info / warn) or `captureException` (error).

```ts
// lib/log.ts
import { Sentry } from './sentry';

type Meta = Record<string, unknown> | undefined;

function breadcrumb(level: 'info' | 'warning' | 'error', message: string, data: Meta): void {
  try {
    Sentry.addBreadcrumb({ level, message, data });
  } catch {
    // Sentry may not be initialized in dev — ignore.
  }
}

export const log = {
  info(message: string, meta?: Meta): void {
    // biome-ignore lint/suspicious/noConsole: dev-time logging surface
    console.info(message, meta ?? '');
    breadcrumb('info', message, meta);
  },
  warn(message: string, meta?: Meta): void {
    // biome-ignore lint/suspicious/noConsole: dev-time logging surface
    console.warn(message, meta ?? '');
    breadcrumb('warning', message, meta);
  },
  error(message: string | Error, meta?: Meta): void {
    if (message instanceof Error) {
      // biome-ignore lint/suspicious/noConsole: dev-time logging surface
      console.error(message, meta ?? '');
      try {
        Sentry.captureException(message, meta ? { extra: meta } : undefined);
      } catch {
        // ignore
      }
      return;
    }
    // biome-ignore lint/suspicious/noConsole: dev-time logging surface
    console.error(message, meta ?? '');
    breadcrumb('error', message, meta);
  },
};
```

Use it like this:

```ts
import { log } from '@/lib/log';

log.info('user.refresh.start', { userId });
log.warn('storage.retry', { attempt: 2 });
log.error(err, { feature: 'auth.callback' });   // err is an Error → captureException
log.error('user.refresh.failed', { code });      // string → breadcrumb only
```

`log.error(Error)` is the **only** built-in path that calls `Sentry.captureException` for you. A bare string is breadcrumb-only and will not produce a Sentry issue. If you have a string-only error case, wrap it: `log.error(new Error('user.refresh.failed'), { code })`.

### 2. Every `catch` either captures or comments

The rule, verbatim: every `catch (e)` block must do one of:

1. Call `log.error(e instanceof Error ? e : new Error(String(e)), { ...context })`, or
2. Call `Sentry.captureException(e)` directly (rare — prefer the wrapper), or
3. Include a `// ignore: <reason>` comment as the first line of the block explaining why the throw is intentional and safe to drop.

```ts
// Pattern A: capture + rethrow
try {
  await api.refresh();
} catch (error) {
  log.error(error instanceof Error ? error : new Error(String(error)), {
    feature: 'auth.refresh',
  });
  throw error;
}

// Pattern B: capture + recover
try {
  const cached = await SecureStore.getItemAsync('user:cache');
  return cached ? JSON.parse(cached) : null;
} catch (error) {
  log.error(error instanceof Error ? error : new Error(String(error)), {
    feature: 'user.cache.read',
  });
  return null;
}

// Pattern C: documented swallow (the ONLY way to skip Sentry)
SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore: splash may already be hidden in dev fast-refresh; safe to drop
});
```

The `// ignore: ...` comment is mandatory because it forces the author to articulate _why_ this error is safe to drop. A reviewer sees the comment and either agrees or pushes back; a bare `catch {}` triggers no thought at all.

### 3. `RootErrorBoundary` is the outermost provider — with a raw-RN fallback

A class component error boundary lives at the very top of `app/_layout.tsx`, wrapping every other provider — Tamagui, Convex, PostHog, the navigator, everything. If any of them throws on render, the boundary catches it, reports to Sentry, and renders a "Try again" fallback. Functional providers cannot catch render errors; this must be a class component.

```tsx
// app/_layout.tsx
import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Sentry } from '@/lib/sentry';

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  override render() {
    if (this.state.hasError) {
      // This boundary wraps TamaguiProvider, so the fallback CANNOT use Tamagui
      // tokens/components — if the crash IS a TamaguiProvider failure, a Tamagui
      // fallback would re-throw and re-trigger the boundary. Raw RN + hex only.
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#15130f' }}>
          <Text style={{ color: '#f7f4ee', fontSize: 18, fontWeight: '600' }}>
            Something went wrong
          </Text>
          <Pressable
            onPress={() => this.setState({ hasError: false })}
            style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#d97757' }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootLayout() { /* ... */ }

export default Sentry.wrap(RootLayout);
```

The wiring: `RootErrorBoundary` is the **outermost** JSX node in `RootLayout`'s return, and `Sentry.wrap(RootLayout)` is the **default export**. The combination means routing breadcrumbs flow through `Sentry.wrap`, and any render error inside the wrapped tree is caught by the boundary before the screen blanks.

**Why the fallback uses raw React Native + hex colors, not Tamagui.** The boundary sits *above* `TamaguiProvider`. A render crash there could be the provider itself failing; if the fallback reached for Tamagui tokens or components it would throw again and the boundary would loop on a blank screen. Raw `View` / `Text` / `Pressable` with literal hex values have no provider dependency, so the fallback renders no matter what failed. This is the one place in the app where raw RN primitives and hex colors are not just allowed but required (the Tamagui tokens-only rule does not apply here).

### 4. Never throw strings

Throwing a string skips the stack trace and produces a near-useless Sentry event. Always throw `Error` (or a subclass).

```ts
// good
throw new Error('user.refresh.failed: missing token');

// good — typed subclass
class AuthRequiredError extends Error {
  constructor() { super('AuthRequiredError'); this.name = 'AuthRequiredError'; }
}
throw new AuthRequiredError();
```

### 5. Don't swallow `await`-ed rejections

A floating promise rejection becomes an unhandled rejection, which on RN crashes the JS context. Either `await` (and wrap in `try/catch`) or `.catch(...)` with an explicit handler.

```ts
// bad — float
SecureStore.setItemAsync('token', token);

// good — awaited
try {
  await SecureStore.setItemAsync('token', token);
} catch (error) {
  log.error(error instanceof Error ? error : new Error(String(error)), {
    feature: 'auth.token.persist',
  });
  throw error;
}

// good — explicit fire-and-forget with documented swallow
SecureStore.setItemAsync('token', token).catch((e) => {
  // ignore: token persistence is best-effort; we will re-issue on next sign-in
  log.warn('auth.token.persist.failed', { error: String(e) });
});
```

## Anti-Patterns

- **Bare `catch {}` with no log and no comment.** A reviewer cannot tell whether the throw is expected or you forgot to handle it. Add `log.error(...)` or a `// ignore: <reason>` comment.
- **`console.log` outside `lib/log.ts`.** Biome's `lint/suspicious/noConsole` flags it. The only allow-listed call sites are inside `lib/log.ts:16`, `:21`, `:27`, `:35` (each with a `biome-ignore` comment). Everywhere else, use `log.*`.
- **`log.error('some string')` for a real failure.** A string-only `log.error` only emits a breadcrumb — no Sentry issue is created. Wrap with `new Error(...)` if you need an issue.
- **Throwing strings.** `throw 'something broke'` has no stack and Sentry shows it as `Error: Non-Error captured`. Use `throw new Error(...)`.
- **`useEffect(() => { somePromise() }, [])` with no `.catch`.** A floating rejection becomes unhandled. Wrap the call in an async IIFE with `try/catch` or attach `.catch(log.error)`.
- **Error boundary placed inside a provider.** If `RootErrorBoundary` sits inside `<TamaguiProvider>` instead of outside it, a TamaguiProvider render error escapes the boundary and blanks the app.
- **Removing `Sentry.wrap` on the default export.** `export default Sentry.wrap(RootLayout)` is what enables routing breadcrumbs and lets `expoRouterIntegration` track screens. Exporting the bare `RootLayout` silently breaks Sentry's performance and routing traces.
- **Using Tamagui in the `RootErrorBoundary` fallback.** The boundary wraps `TamaguiProvider`; a Tamagui-based fallback re-throws when the crash is a provider failure. Keep the fallback on raw RN primitives + hex.

## Decision Rationale

- **One logging surface (`lib/log.ts`)** means a future change — say, adding a log-rate-limiter, or piping warnings to PostHog — happens in one file. Direct `console.*` calls across the codebase would require a sweep.
- **`log.error(Error)` auto-captures, `log.error(string)` does not.** This asymmetry is intentional — it forces the author to think "is this a real exception or a debug breadcrumb?" Strings stay cheap (breadcrumb only); Errors get the full Sentry treatment.
- **Mandatory `// ignore: <reason>` comments** make silent failures reviewable. A reviewer can grep for `// ignore:` and audit every one in five minutes.
- **Class-component `RootErrorBoundary` at the outermost position** is the only way to catch render errors in any provider; functional components and hooks cannot.
- **No string throws** is a hard rule because Sentry's deduplication, stack symbolication, and breadcrumb stitching all depend on receiving an `Error` instance.
