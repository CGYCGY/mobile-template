# PostHog — Product Analytics

`posthog-react-native` ships event analytics, feature flags, and (optionally) session replay. Initialized once via `PostHogProvider` at the app root, then consumed throughout the tree via hooks.

## 1. Create the project

PostHog → **+ New Project**. Platform: **React Native**. Region: pick the region nearest your users (EU or US) for the lowest latency and to match data residency requirements.

After creation, PostHog shows two values:

- **Project API key** — `phc_...`. Public; embedded in the client bundle.
- **Host** — `https://us.i.posthog.com` (US), `https://eu.i.posthog.com` (EU), or your self-hosted URL.

## 2. Wire env vars

```
EXPO_PUBLIC_POSTHOG_KEY=phc_XXXXXXXXXXXXXXXXXX
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

`EXPO_PUBLIC_` prefix is required so Expo bundles them into the runtime.

## 3. Provider at the root

`app/_layout.tsx` wraps the app with `PostHogProvider`:

```tsx
import { PostHogProvider } from 'posthog-react-native';

export default function RootLayout() {
  return (
    <PostHogProvider
      apiKey={process.env.EXPO_PUBLIC_POSTHOG_KEY}
      options={{
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
        captureAppLifecycleEvents: true,
      }}
    >
      <App />
    </PostHogProvider>
  );
}
```

Wrap **inside** the Sentry boundary (`Sentry.wrap`) so analytics initialization errors are caught.

## 4. Usage

```tsx
import { usePostHog, useFeatureFlag } from 'posthog-react-native';

function Settings() {
  const posthog = usePostHog();
  const showBetaTab = useFeatureFlag('beta-tab');

  const onSave = () => {
    posthog.capture('profile_saved', { source: 'settings_screen' });
  };

  return showBetaTab ? <BetaTab /> : <RegularTab />;
}
```

Event naming convention: `noun_verb` snake_case (`profile_saved`, `message_sent`, `subscription_started`). Properties go in the second arg.

## 5. Identify users on sign-in

PostHog tracks anonymous users by default. After the WorkOS sign-in callback completes (`completeSignIn` in `lib/auth/`), call `identify`:

```ts
posthog.identify(user.id, {
  email: user.email,
  name: user.displayName,
  $set_once: { signed_up_at: new Date().toISOString() },
});
```

This stitches the anonymous pre-signup session to the identified user — the funnel from anonymous to signed-up stays intact.

On sign-out, call `posthog.reset()` to drop the identification (otherwise the next anonymous session inherits the previous user's distinct ID).

## 6. Privacy and capture surface

PostHog defaults are reasonable but worth a deliberate decision per app:

- **Autocapture** (taps, screen views): on by default. Disable per-element with the `ph-no-capture` prop, or globally via `options.autocapture: false`.
- **Session replay**: opt-in (`enableSessionReplay: true` in `options`). Replay captures the rendered UI — review for PII before turning it on. Mask any text input that handles passwords, payment data, or PII with `ph-no-capture` or PostHog's `<PostHogPrivateView>`.
- **Captured properties**: PostHog auto-captures device model, OS version, locale, and app version. None of that is PII, but `posthog.capture('event', { ... })` payloads are at your discretion — avoid putting raw emails, names, or addresses in custom event properties; reference user IDs instead.

For App Store / Play Store privacy disclosures, PostHog provides a [data-collection summary](https://posthog.com/docs/privacy/data-collection) that maps cleanly to the labels Apple and Google ask for.

## 7. Verifying

Trigger an event during dev:

```ts
posthog.capture('debug_check');
```

PostHog → **Activity → Live events**. The event appears within a few seconds. If it doesn't:

- Confirm `EXPO_PUBLIC_POSTHOG_KEY` is loaded (`console.log(process.env.EXPO_PUBLIC_POSTHOG_KEY)`).
- Check the host matches the project's region.
- The first few events in a fresh project can take up to a minute to surface — refresh.

## References

- PostHog React Native: <https://posthog.com/docs/libraries/react-native>
- Feature flags: <https://posthog.com/docs/feature-flags>
- Session replay: <https://posthog.com/docs/session-replay>
