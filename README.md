# mobile-template

Opinionated starter for cross-platform mobile apps. Pairs with [webapp-template](../webapp-template/) when you want a web counterpart on the same backend.

## Stack

- **Expo SDK 55** + **React Native 0.83** + **React 19** + **TypeScript strict** + **New Architecture**
- **Expo Router** — file-based routing in `app/`
- **Bun** — package manager + runtime
- **Convex** — DB, realtime, auth bridge, R2 presigning, push fan-out
- **WorkOS AuthKit** — OAuth + PKCE flow implemented with `expo-web-browser` + `expo-crypto` + `expo-secure-store` (WorkOS does not ship an official React Native SDK); refresh token in SecureStore
- **Tamagui** + **Lucide** — UI primitives and icons
- **React Hook Form** + **Zod** — forms with schema shared client/server
- **Zustand** (with `persist`/MMKV) — client state
- **react-native-mmkv** + **expo-secure-store** — fast KV and secret-safe KV
- **react-native-quick-crypto** — JSI-backed crypto for PKCE
- **Sentry** — crash and error reporting (`@sentry/react-native`)
- **PostHog** — product analytics + feature flags (`posthog-react-native`)
- **Cloudflare R2** — file uploads via Convex-presigned PUTs
- **Expo Notifications** + **Expo Push Service** — push to APNs and FCM
- **EAS Build / Submit / Update** — cloud build, store submission, OTA
- **Biome** (lint + format), **Lefthook** (git hooks), **Jest** + **Maestro** (unit + E2E)
- **just** — task runner ([justfile](justfile))

> Expo Go does **not** work with this stack — you must build a custom dev client. See [docs/dev-client.md](docs/dev-client.md).

## Getting started

```bash
# Prereqs: Bun ≥1.2, Xcode (iOS), Android Studio (Android), EAS CLI (bunx eas-cli)
bun install
cp .env.local.example .env.local       # fill in Convex, WorkOS, PostHog, Sentry values
bunx eas-cli login                      # first time only
bunx eas-cli init                       # writes projectId into app.config.ts
bunx convex dev                         # one-time: provisions a Convex deployment
just env-sync                           # push WORKOS_* and R2_* into Convex
bunx eas-cli build --profile development --platform ios     # ~20 min first build
# (or --platform android)
# install the resulting .ipa/.apk on simulator or device
bun start                               # then open in the installed dev client
```

Full dev-client walk-through: [docs/dev-client.md](docs/dev-client.md).

## Environment variables

Required (see `.env.local.example`):

**Client-bundled (`EXPO_PUBLIC_*`):**

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_WORKOS_CLIENT_ID`
- `EXPO_PUBLIC_WORKOS_REDIRECT_URI` (`mobiletemplate://auth/callback` in dev)
- `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST`

**Build-time only (EAS secrets):**

- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`

**Convex-only (set via `just env-set` or `just env-sync`):**

- `WORKOS_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`

Schemas live in `env.ts`. Missing or malformed values fail the build, not runtime.

## Commands

`just --list` shows everything. Most-used:

| Command                  | What it does                                                |
|--------------------------|-------------------------------------------------------------|
| `just dev`               | Convex sync + Expo dev server in a tmux split               |
| `just dev-stop`          | Kill the tmux session and any stray dev processes           |
| `just start`             | Expo dev server (with dev client)                           |
| `just ios` / `just android` | Run on simulator / emulator via `expo run:*`             |
| `just prebuild`          | Regenerate native `ios/` / `android/` from `app.config.ts`  |
| `just convex-dev`        | Convex sync only                                            |
| `just convex-codegen`    | Regenerate Convex client types                              |
| `just env-sync`          | Push `WORKOS_*` and `R2_*` from `.env.local` into Convex    |
| `just build-ios` / `just build-android` | EAS cloud build                              |
| `just submit-ios` / `just submit-android` | EAS store submission                       |
| `just ota`               | Publish an Expo Updates OTA bundle                          |
| `just check`             | Biome: lint + format + organize imports                     |
| `just typecheck`         | `tsc --noEmit`                                              |
| `just test`              | Jest (unit)                                                 |
| `just e2e`               | Maestro (requires built dev client on simulator/device)     |

## Layout

```
app/                Expo Router routes (auth flow, tabs)
components/         App-level components + UI primitives in components/ui/
convex/             Schema, queries, mutations, auth bridge, R2 + push actions
lib/
  auth/             WorkOS PKCE + token handling
  storage/          MMKV (fast KV) + SecureStore (secrets)
  notifications/    Expo push registration + channel setup
  r2/               Presigned upload helper
  convex/           Convex client wiring
stores/             Zustand stores
assets/             Icons, splash
app.config.ts       Expo config (plugins, bundle ID, scheme)
eas.json            EAS build / submit / update profiles
env.ts              Zod schema for env vars
```

## Docs

- [docs/dev-client.md](docs/dev-client.md) — why Expo Go is unusable and how to build a dev client
- [docs/eas.md](docs/eas.md) — EAS Build / Submit / Update reference
- [docs/auth-deep-links.md](docs/auth-deep-links.md) — upgrade from custom scheme to universal / app links
- [docs/r2.md](docs/r2.md) — Cloudflare R2 setup and the upload flow
- [docs/push.md](docs/push.md) — APNs / FCM setup and the Convex push action
- [docs/sentry.md](docs/sentry.md) — crash reporting and sourcemap upload
- [docs/posthog.md](docs/posthog.md) — analytics, feature flags, identify on sign-in

## When paired with webapp-template

If you spawn a real project from both templates, **the web app owns Convex** — the mobile app deletes its `convex/` folder and pulls only generated types. See [docs/convex.md](docs/convex.md) for the full ownership model and migration steps.

## Deployment

Mobile builds are produced and signed by EAS, then submitted to the App Store and Play Store via `just submit-ios` / `just submit-android`. JS-only changes ship through Expo Updates (`just ota`) without a store review. Convex functions deploy separately with `bunx convex deploy` (typically from the web repo when paired).
