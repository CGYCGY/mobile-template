---
name: observability-sentry
description: Sentry wiring for this codebase - module-scope init at the top of app/_layout.tsx, Sentry.wrap on the default export, reactNavigationIntegration for Expo Router 6 / React Navigation 7, breadcrumbs via lib/log.ts, and flush(2000) before any forced restart.
---

# Observability: Sentry

## Purpose

Sentry is the crash + error pipeline for this codebase. The SDK must be live before the first React component renders so that startup crashes, font-loading failures, and provider errors all reach Sentry. That means `Sentry.init(...)` is a module-scope side-effect at the top of `app/_layout.tsx`, never lazy and never inside a hook. The default export of the root layout is wrapped with `Sentry.wrap(...)` to capture touch breadcrumbs, the perf root span, and routing transactions through `reactNavigationIntegration` (the integration that works on Expo Router 6 / React Navigation 7). Sourcemaps upload during EAS Build via the `@sentry/react-native/expo` plugin - no manual upload step.

## Patterns

### 1. Module-scope init in the root layout

`Sentry.init` runs at module top level, before `RootLayout` is declared and before any provider mounts. Then the default export is `Sentry.wrap(RootLayout)`.

```tsx
// app/_layout.tsx
import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import { env } from '@/env';

Sentry.init({
  dsn: env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: __DEV__ ? 1.0 : 0.1,
  enableNativeFramesTracking: !__DEV__,
  integrations: [
    Sentry.reactNavigationIntegration({ enableTimeToInitialDisplay: true }),
  ],
  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    return event;
  },
});

function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default Sentry.wrap(RootLayout);
```

`reactNavigationIntegration()` covers both react-navigation and expo-router - it hooks the shared navigation container that Expo Router mounts under the hood. No separate `routingInstrumentation` constant is needed.

### 2. User context tied to the auth lifecycle

Set the Sentry user on sign-in, clear it on sign-out. Only the stable id and email travel - never names, phones, or tokens. Pair this with `posthog.identify` / `posthog.reset` (see `observability-posthog.md`).

```ts
// lib/auth/session.ts (sketch)
import * as Sentry from '@sentry/react-native';

export async function onSignedIn(user: { id: string; email: string }): Promise<void> {
  Sentry.setUser({ id: user.id, email: user.email });
}

export async function onSignedOut(): Promise<void> {
  Sentry.setUser(null);
}
```

### 3. Breadcrumbs and exception capture via `lib/log.ts`

`log.info / log.warn / log.error` is the single logging surface for app code. It writes to `console` for dev and forwards to Sentry as breadcrumbs (info / warning) or `captureException` (error).

```ts
// lib/log.ts
import { Sentry } from './sentry';

function breadcrumb(level: 'info' | 'warning' | 'error', message: string, data: Meta): void {
  try {
    Sentry.addBreadcrumb({ level, message, data });
  } catch {
    // Sentry may not be initialized in dev - ignore.
  }
}

export const log = {
  error(message: string | Error, meta?: Meta): void {
    if (message instanceof Error) {
      Sentry.captureException(message, meta ? { extra: meta } : undefined);
      return;
    }
    breadcrumb('error', message, meta);
  },
  // info / warn omitted - same shape, breadcrumb only
};
```

Use it like this in app/services code:

```ts
import { log } from '@/lib/log';

try {
  await api.refresh();
} catch (error) {
  log.error(error instanceof Error ? error : new Error(String(error)), {
    feature: 'auth.refresh',
  });
  throw error;
}
```

Every `catch` either calls `log.error(err)` / `Sentry.captureException(err)`, or has a `// ignore: <reason>` comment. Silent catches are forbidden.

### 4. Flush before any forced restart

In-flight events are dropped if the JS context is torn down before they ship. Always `await Sentry.flush(2000)` before `Updates.reloadAsync()`, `RNRestart.restart()`, or any deliberate process exit.

```ts
import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

export async function applyUpdateAndRestart(): Promise<void> {
  await Updates.fetchUpdateAsync();
  await Sentry.flush(2000);
  await Updates.reloadAsync();
}
```

### 5. EAS sourcemap upload (no manual step)

`@sentry/react-native/expo` is listed in `app.config.ts` plugins, and `SENTRY_AUTH_TOKEN` is provided via EAS env. Sourcemaps upload automatically during `eas build`.

```ts
// app.config.ts
plugins: [
  'expo-router',
  'expo-notifications',
  '@sentry/react-native/expo',
],
```

```json
// eas.json
{
  "build": {
    "production": {
      "env": { "SENTRY_AUTH_TOKEN": "$SENTRY_AUTH_TOKEN" }
    }
  }
}
```

One-time setup: `eas secret:create --name SENTRY_AUTH_TOKEN --value $TOKEN`.

## Anti-Patterns

- **Lazy `initSentry()` helper called from inside the app.** `lib/sentry.ts:6` currently exports `function initSentry()` guarded by a module-level `initialized` flag, and no caller invokes it. That means Sentry never starts. Fix: delete the helper, move `Sentry.init({...})` to module scope at the top of `app/_layout.tsx`, and re-export `Sentry` from `lib/sentry.ts` only if other modules need it.
- **Missing `reactNavigationIntegration` and `Sentry.wrap`.** `app/_layout.tsx:82` exports `Sentry.wrap(RootLayout)` but the init call is missing entirely (because of the lazy helper above). Without `reactNavigationIntegration` in `integrations`, routing transactions and screen breadcrumbs are lost on Expo Router 6 / React Navigation 7.
- **Silent catches.** `lib/log.ts:31` has a `// ignore` comment - that is the documented exception. Any other `catch (e) { }` without `Sentry.captureException` or an `// ignore: <reason>` comment is an anti-pattern.
- **Restarting without flushing.** Calling `Updates.reloadAsync()` or `RNRestart.restart()` without first awaiting `Sentry.flush(2000)` drops the events that triggered the restart.
- **DSN without `EXPO_PUBLIC_` prefix.** Anything other than `process.env.EXPO_PUBLIC_SENTRY_DSN` (read through `env`) is `undefined` on device and the SDK silently no-ops.

## Decision Rationale

See `../decisions.md` for:

- Why `Sentry.init` lives at module scope in the route layer rather than as a lazy helper in `lib/`
- Why `reactNavigationIntegration` is the chosen integration over the deprecated `routingInstrumentation` constant
- Why breadcrumbs go through `lib/log.ts` instead of direct `Sentry.addBreadcrumb` calls in app code
- Why sourcemap upload is delegated to the EAS plugin rather than a post-build CI step
