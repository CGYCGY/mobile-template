---
name: env-and-config
description: Environment validation via Zod at module load and native config in app.config.ts for this codebase — fail-fast schemas, EXPO_PUBLIC_ scoping, variant-driven bundle identifiers, and the runtimeVersion appVersion contract.
---

# Environment & Native Config

## Purpose

Every environment variable this codebase reads is validated by Zod at module load, so a misconfigured deploy fails on import — not three screens deep when a token is missing. `env.ts` is the single read-site for `process.env`; nothing else in `app/`, `components/`, `lib/`, or `stores/` may touch `process.env` directly. Native configuration lives in `app.config.ts`, which derives the bundle identifier, channel, and updates URL from a single `APP_VARIANT` switch. The `runtimeVersion: { policy: 'appVersion' }` policy locks OTA compatibility to the marketing version — a JS-only fix can ship via `eas update`, but adding a native module forces a new binary and a store submit.

## Patterns

### 1. Fail-fast env schema in `env.ts`

Two Zod schemas — one for client-bundled vars (must be `EXPO_PUBLIC_*`), one for build-time/server-only vars — parse on module load and throw a structured error listing every issue.

```ts
// env.ts
import * as z from 'zod';

const clientSchema = z.object({
  EXPO_PUBLIC_CONVEX_URL: z.string().url(),
  EXPO_PUBLIC_WORKOS_CLIENT_ID: z.string().min(1),
  EXPO_PUBLIC_WORKOS_REDIRECT_URI: z
    .string()
    .min(1)
    .default('mobiletemplate://auth/callback'),
  EXPO_PUBLIC_POSTHOG_KEY: z.string().min(1),
  EXPO_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
  // DSNs are not secrets; they must be EXPO_PUBLIC_ to be inlined by
  // babel-preset-expo and reach the device. So the DSN lives in clientSchema.
  EXPO_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
});

const buildSchema = z.object({
  // Build-time only — never inlined into the bundle.
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
});

// ... parse, then THROW with aggregated issues — except under eas-cli (see below) ...

export const env = { ...clientResult.data, ...buildResult.data };
export type Env = typeof env;
```

**`EXPO_PUBLIC_SENTRY_DSN` vs `SENTRY_AUTH_TOKEN`.** The DSN is a public write-only endpoint id, not a secret — and it must carry the `EXPO_PUBLIC_` prefix or `babel-preset-expo` won't inline it and `Sentry.init` no-ops on device. The auth token is a real secret used only to upload sourcemaps during the build, so it stays unprefixed and build-time-only.

### 1a. Warn (don't throw) under eas-cli

Validation throws on missing/invalid env at module load — **except** when running under `eas-cli`, where it logs a `console.warn` instead. eas-cli introspects the config without loading `.env` files (it sets `EXPO_NO_DOTENV=1` for subprocesses, and in-process `@expo/config` reads where only `argv` identifies it); the real values are injected on the EAS build servers. A hard throw here would break every local `eas` command.

```ts
// env.ts — gate the throw
const underEasCli =
  !!process.env.EXPO_NO_DOTENV ||
  (process.argv[1] ?? '').split(/[\\/]/).some((s) => s === 'eas' || s === 'eas-cli');
if (underEasCli) console.warn(message);
else throw new Error(message);
```

Consumers import the typed `env` object — never `process.env`:

```ts
import { env } from '@/env';

const client = new ConvexReactClient(env.EXPO_PUBLIC_CONVEX_URL);
```

### 2. `EXPO_PUBLIC_*` vs server-only

Anything prefixed `EXPO_PUBLIC_` is inlined into the client bundle at build time and is therefore public. Treat the prefix as "I am about to ship this string to every user's device":

| Variable kind | Prefix | Lives in | Set via |
|---------------|--------|----------|---------|
| Public client config (URLs, public client IDs, **Sentry DSN**) | `EXPO_PUBLIC_*` | `.env.local`, EAS build env | git-ignored `.env.local` or `eas.json` `env` |
| Build-time tooling (Sentry **auth token**) | unprefixed | EAS secret | `eas secret:create --name SENTRY_AUTH_TOKEN` |
| Server / backend (WorkOS API secret, R2 keys) | unprefixed | Convex env | `just env-set KEY VALUE` |

Never put an unprefixed secret in `.env.local` and expect it to reach the device — Metro strips it. Never put a real secret behind `EXPO_PUBLIC_` — it ships to every user.

### 3. Variant-driven `app.config.ts`

`APP_VARIANT` is set by the EAS build profile. The config derives the bundle id suffix from it. The first import is `./env` — that triggers env validation before any other native config evaluates.

```ts
// app.config.ts
import type { ExpoConfig } from 'expo/config';
import './env';

type Variant = 'dev' | 'preview' | 'production';

const variant = (process.env.APP_VARIANT ?? 'production') as Variant;

const bundleSuffix: Record<Variant, string> = {
  dev: '.dev',
  preview: '.preview',
  production: '',
};

const baseId = 'com.example.mobiletemplate';
const bundleIdentifier = `${baseId}${bundleSuffix[variant]}`;
```

Three variants → three side-by-side installs on a device (e.g., `com.example.mobiletemplate.dev`, `.preview`, plain prod). QA never confuses builds.

### 4. The `runtimeVersion: 'appVersion'` contract

```ts
// app.config.ts
runtimeVersion: { policy: 'appVersion' },
```

`appVersion` means the OTA runtime version equals the `version` field. The implications are non-negotiable:

- A JS-only change at the same `version` ships via `eas update`. Old and new binaries with matching `version` see it.
- Adding, removing, or upgrading a **native module** (e.g., `react-native-mmkv`, `react-native-quick-crypto`) requires bumping `version` AND running `eas build`. An OTA cannot ship native binaries.
- Bumping `version` invalidates the OTA channel for older binaries — they will only receive updates again after the user installs the new build from the store.

When in doubt: did `package.json` add a native dep? Build, don't OTA.

## Anti-Patterns

- **Reading `process.env` outside `env.ts`.** Any `process.env.FOO` in `app/`, `components/`, `lib/`, or `stores/` bypasses Zod validation and produces `undefined` at runtime on device. Add the key to a schema in `env.ts:3` / `env.ts:14`, then import `env`.
- **Hard-coded URLs / IDs.** A literal Convex URL or WorkOS client id baked into source defeats per-environment swapping. Use `env.EXPO_PUBLIC_*`.
- **Secrets in `app.config.ts`.** Anything literal in `app.config.ts:14` (e.g., the `baseId`) is fine because it is public. A Sentry auth token or WorkOS API secret in this file would be checked into git. Use EAS secrets and reference via `process.env.*` inside `env.ts` only.
- **Missing `EXPO_PUBLIC_` prefix on a client-side var.** A DSN read as `process.env.SENTRY_DSN` (unprefixed) is `undefined` on device — `babel-preset-expo` only inlines `EXPO_PUBLIC_*` — so Sentry silently no-ops. The DSN belongs in `clientSchema` as `EXPO_PUBLIC_SENTRY_DSN`; the auth token (a real secret) stays unprefixed in `buildSchema`.
- **Throwing on missing env after first render.** Validation must happen at module top level (as `env.ts` does today), not inside a hook — by the time a hook fires, providers have already started. The one nuance: under eas-cli the failure is a `console.warn`, not a throw, because EAS introspects the config without `.env`.
- **Hand-editing native `Info.plist` / `AndroidManifest.xml`.** `app.config.ts` is the single source of truth; native folders are regenerated by `expo prebuild`. Manual edits are overwritten.

## Decision Rationale

- **Fail-fast at module load** beats lazy validation because the missing-env stack trace points at `env.ts` instead of a Sentry call deep inside a screen. The deliberate exception is eas-cli, where the same check warns instead of throwing so config introspection (which runs without `.env`) doesn't break.
- **Two schemas, one merged export** keeps the public/secret distinction visible in the source — a reviewer sees immediately whether a new key belongs in `clientSchema` (shipped to device) or `buildSchema` (tooling-only).
- **Variant suffix in `app.config.ts`** trades a few lines of derivation for three side-by-side installs. Without it, internal testers must uninstall to switch between dev and prod.
- **`policy: 'appVersion'`** ties the OTA boundary to a number a human is forced to think about (the marketing version). The alternative — `policy: 'nativeVersion'` — silently couples to fingerprints and lets reviewers OTA-ship native-incompatible code.
