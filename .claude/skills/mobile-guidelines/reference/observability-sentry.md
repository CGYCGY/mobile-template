---
name: observability-sentry
description: Sentry wiring for this codebase - module-scope init in lib/sentry.ts (imported first by app/_layout.tsx), Sentry.wrap on the default export, expoRouterIntegration, EXPO_PUBLIC_SENTRY_DSN, breadcrumbs via lib/log.ts, and flush(2000) before any forced restart.
---

# Observability: Sentry

## Purpose

Sentry is the crash + error pipeline for this codebase. The SDK must be live before the first React component renders so that startup crashes, font-loading failures, and provider errors all reach Sentry. That is achieved by putting `Sentry.init(...)` as a module-scope side-effect in `lib/sentry.ts`, which `app/_layout.tsx` imports on its very first line — never lazy and never inside a hook. The default export of the root layout is wrapped with `Sentry.wrap(...)` to capture touch breadcrumbs, the perf root span, and routing transactions through `expoRouterIntegration`. The DSN is read as `EXPO_PUBLIC_SENTRY_DSN` (DSNs are not secrets and must be `EXPO_PUBLIC_` to be inlined). Sourcemaps upload during EAS Build via the `@sentry/react-native/expo` plugin (Android Gradle plugin path) with `SENTRY_DISABLE_AUTO_UPLOAD` set per profile - no manual upload step.

## Patterns

### 1. Module-scope init, imported first by the root layout

`Sentry.init` runs at module top level in `lib/sentry.ts`. `app/_layout.tsx` imports that file on its **first line** (`import '@/lib/sentry';`), so init runs before `RootLayout` is declared and before any provider mounts. The default export is `Sentry.wrap(RootLayout)`.

```ts
// lib/sentry.ts
import * as Sentry from '@sentry/react-native';
import { env } from '@/env';

if (env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    enableAutoSessionTracking: true,
    // expoRouterIntegration auto-wires expo-router's navigationRef; unlike
    // reactNavigationIntegration it needs no manually-registered ref.
    integrations: [Sentry.expoRouterIntegration()],
  });
}

export const wrap = Sentry.wrap;
export { Sentry };
```

```tsx
// app/_layout.tsx
import '@/lib/sentry';
// ...
export default Sentry.wrap(RootLayout);
```

`expoRouterIntegration()` is the chosen integration on this stack: expo-router (SDK 56) auto-registers its own navigation ref, so the integration hooks routing transactions and screen breadcrumbs with no manual ref wiring. The `init` is guarded on a truthy DSN — with no DSN the SDK is simply never started.

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

### 5. EAS sourcemap upload (Android Gradle plugin)

`@sentry/react-native/expo` is listed in `app.config.ts` plugins with `experimental_android: { enableAndroidGradlePlugin: true }`. The default bundle-task hook can't parse Expo's `export:embed`-flavored task and skips the upload, so the Android Gradle plugin (AGP) integration uploads Hermes sourcemaps reliably instead. `SENTRY_AUTH_TOKEN` is provided via EAS env; `SENTRY_DISABLE_AUTO_UPLOAD: "true"` is set in every EAS build profile.

```ts
// app.config.ts
plugins: [
  // ...
  [
    '@sentry/react-native/expo',
    {
      organization: process.env.SENTRY_ORG ?? 'your-sentry-org',
      project: process.env.SENTRY_PROJECT ?? 'mobile-template',
      experimental_android: { enableAndroidGradlePlugin: true },
    },
  ],
],
```

```json
// eas.json — every profile sets this
{
  "build": {
    "production": {
      "env": { "SENTRY_DISABLE_AUTO_UPLOAD": "true" }
    }
  }
}
```

One-time setup: `eas secret:create --name SENTRY_AUTH_TOKEN --value $TOKEN` (build-time only — `SENTRY_AUTH_TOKEN` stays unprefixed; it is never inlined into the client bundle).

## Anti-Patterns

- **Lazy `initSentry()` helper called from inside the app.** Init must be a module-scope side-effect in `lib/sentry.ts` (imported first by `app/_layout.tsx`). A helper guarded by an `initialized` flag that no caller invokes means Sentry never starts.
- **Dropping `expoRouterIntegration` or `Sentry.wrap`.** The default export must stay `Sentry.wrap(RootLayout)`, and `expoRouterIntegration()` must stay in `integrations` — without it, routing transactions and screen breadcrumbs are lost. Do not swap it back to `reactNavigationIntegration` (that requires a manually-registered nav ref this app no longer wires).
- **Silent catches.** `lib/log.ts:31` has a `// ignore` comment - that is the documented exception. Any other `catch (e) { }` without `Sentry.captureException` or an `// ignore: <reason>` comment is an anti-pattern.
- **Restarting without flushing.** Calling `Updates.reloadAsync()` or `RNRestart.restart()` without first awaiting `Sentry.flush(2000)` drops the events that triggered the restart.
- **DSN without `EXPO_PUBLIC_` prefix.** Anything other than `process.env.EXPO_PUBLIC_SENTRY_DSN` (read through `env`) is `undefined` on device and the SDK silently no-ops.

## Decision Rationale

See `../decisions.md` for:

- Why `Sentry.init` lives as a module-scope side-effect in `lib/sentry.ts` (imported first by `app/_layout.tsx`) rather than a lazy helper
- Why `expoRouterIntegration` is the chosen integration (expo-router auto-registers its nav ref) over `reactNavigationIntegration`
- Why breadcrumbs go through `lib/log.ts` instead of direct `Sentry.addBreadcrumb` calls in app code
- Why sourcemap upload is delegated to the EAS plugin (Android Gradle plugin path) rather than a post-build CI step
