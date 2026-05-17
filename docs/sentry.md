# Sentry — Crash and Error Reporting

`@sentry/react-native` catches native crashes (iOS and Android), unhandled JS exceptions, and unhandled promise rejections, then ships them to Sentry with sourcemaps so the stack traces are readable.

## 1. Create the project

Sentry → **Projects → Create Project**.

- Platform: **React Native**.
- Alert frequency: default is fine.
- Team: whichever you want to own the project.

After creation, Sentry shows the DSN — copy it.

## 2. Wire the DSN

Put the DSN in `.env.local`:

```
SENTRY_DSN=https://abcdef@o12345.ingest.sentry.io/67890
```

The DSN is technically public (it's embedded in every shipped client binary) so committing it in a public template is fine, but keeping it in `.env.local` makes per-project overrides cleaner.

## 3. Auth token for sourcemap upload

Sourcemaps must be uploaded at **build** time so Sentry can translate the minified stack frames back to source. This needs a Sentry CLI auth token with `project:releases` scope.

1. Sentry → **Settings → Account → Auth Tokens → Create New Token**.
2. Scopes: `project:read`, `project:releases`, `org:read`.
3. Copy the token (shown once).

Store it as an **EAS secret** — it must be available inside the EAS build worker, not in the JS bundle:

```bash
bunx eas-cli secret:create --scope project --name SENTRY_AUTH_TOKEN --value sntrys_...
```

For local builds (`--local`), export it in your shell or in a `.env` that EAS reads:

```bash
export SENTRY_AUTH_TOKEN=sntrys_...
```

## 4. Config plugin handles native init

`app.config.ts` lists `@sentry/react-native/expo` in `plugins`. The plugin:

- Adds the native Sentry SDK to both Android and iOS at prebuild.
- Wires the Xcode build phase / Gradle task that uploads sourcemaps after the JS bundle is built.
- Reads `SENTRY_AUTH_TOKEN`, organization, and project from env at build time.

You may need to set `SENTRY_ORG` and `SENTRY_PROJECT` env vars as well — Sentry CLI normally infers them, but EAS workers don't have a `.sentryclirc`. Add to `eas.json`:

```json
"build": {
  "preview": {
    "env": {
      "APP_VARIANT": "preview",
      "SENTRY_ORG": "your-org-slug",
      "SENTRY_PROJECT": "mobile-template"
    }
  }
}
```

## 5. JS-side init

`app/_layout.tsx` wraps the root with `Sentry.wrap(App)`:

```tsx
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  enableAutoSessionTracking: true,
  tracesSampleRate: __DEV__ ? 1.0 : 0.1,
});

export default Sentry.wrap(RootLayout);
```

`Sentry.wrap` installs the error boundary, the JS unhandled-rejection handler, and the touch-event breadcrumb tracker.

If the DSN is referenced from JS, prefix it `EXPO_PUBLIC_` so Expo includes it in the runtime bundle. The non-prefixed `SENTRY_DSN` is also OK to reference, but only inside files that run at build time (like `app.config.ts`).

## 6. Verify it works

Throw a test error in dev:

```ts
import * as Sentry from '@sentry/react-native';

Sentry.captureException(new Error('Sentry test from mobile-template'));
```

Or trigger a native crash:

```ts
Sentry.nativeCrash();
```

(Don't ship `nativeCrash()` to production — it's a hard crash.)

Open the Sentry dashboard → **Issues**. Within ~30s you should see the event. If you don't:

- Check the DSN is correct — Sentry rejects events from unknown DSNs silently.
- Check that `Sentry.init` ran. Adding `debug: true` to `init` logs Sentry's startup to the Metro console.
- Sourcemaps may not have uploaded — the stack will appear minified. Check the Sentry **Releases** page: a release for your build should be present with sourcemap artifacts attached.

## What gets captured

- **JS unhandled exceptions** — including async `.then()` rejections.
- **Native crashes** — iOS Mach exceptions, Android NDK crashes, JNI errors.
- **ANRs (Android only)** — when the main thread is blocked >5s.
- **Touch breadcrumbs** — the last few user taps before the crash.
- **Console breadcrumbs** — `console.log`/`warn`/`error` calls.

To exclude noisy errors, use Sentry's **Inbound Filters** (Project Settings → Inbound Filters) — that's faster than redeploying with `beforeSend` logic.

## References

- Sentry React Native: <https://docs.sentry.io/platforms/react-native/>
- Expo integration: <https://docs.sentry.io/platforms/react-native/manual-setup/expo/>
