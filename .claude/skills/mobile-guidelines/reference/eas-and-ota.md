---
name: eas-and-ota
description: EAS Build + Submit + Update workflow for this codebase — three profiles, variant-to-bundle-id mapping, the runtimeVersion appVersion rule for when OTA is and is not safe, and a pre-OTA gate.
---

# EAS Build, Submit, and OTA Updates

## Purpose

Three EAS profiles — `development`, `preview`, `production` — give this codebase three distinct binaries with distinct bundle identifiers, distinct OTA channels, and distinct install slots on the same device. The `runtimeVersion: { policy: 'appVersion' }` policy is the single rule that decides whether a change can ship as an OTA update or must be a new binary: anything that crosses the JS/native boundary requires `eas build`; pure JS/asset changes ride `eas update`. Get that distinction wrong and the OTA is either rejected (mismatched runtime version) or — worse — crashes on launch because a native module is missing.

## Patterns

### 1. The three build profiles

```json
// eas.json
{
  "cli": { "version": ">= 13.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "env": { "APP_VARIANT": "dev" }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "autoIncrement": true,
      "channel": "production",
      "env": { "APP_VARIANT": "production" }
    }
  }
}
```

Each profile sets `APP_VARIANT`, which `app.config.ts` reads to derive the bundle identifier:

| Profile | `APP_VARIANT` | Bundle id suffix | Channel | Distribution |
|---------|---------------|------------------|---------|--------------|
| `development` | `dev` | `.dev` | `development` | internal (dev client) |
| `preview` | `preview` | `.preview` | `preview` | internal |
| `production` | `production` | _(none)_ | `production` | store |

A device can hold all three installs simultaneously, each with its own data directory.

### 2. Build commands (via `just`)

```just
# justfile
build-ios *args:
    bunx eas build --platform ios {{ args }}

build-android *args:
    bunx eas build --platform android {{ args }}

submit-ios *args:
    bunx eas submit --platform ios {{ args }}

submit-android *args:
    bunx eas submit --platform android {{ args }}

ota *args:
    bunx eas update {{ args }}
```

Typical flows:

```bash
# Internal preview build for iOS
just build-ios --profile preview

# Production iOS build with auto-incremented buildNumber
just build-ios --profile production

# Submit the latest production iOS build
just submit-ios --profile production

# Ship a JS-only fix to the production channel
just ota --branch production --message "fix: settings screen crash"
```

### 3. `runtimeVersion: 'appVersion'` — when OTA works

```ts
// app.config.ts
runtimeVersion: { policy: 'appVersion' },
```

A client only accepts an OTA whose `runtimeVersion` matches the version baked into its binary at build time. With `policy: 'appVersion'`, that value equals the `version` field in `app.config.ts` (e.g., `'0.1.0'`).

| Change kind | Examples | OTA-safe? | Action |
|-------------|----------|-----------|--------|
| JS / TS source | bug fix in a screen, copy change, new Tamagui style | yes | `just ota --branch production` |
| Static asset | bundled image, JSON, font already declared | yes | `just ota` |
| New JS-only dependency | `date-fns`, `zod` plugin | yes | `just ota` |
| New native module | adding `react-native-mmkv`, `expo-camera` | **no** | bump `version` → `just build-*` → submit |
| Native config change | new permission, new URL scheme, new plugin in `app.config.ts` | **no** | bump `version` → `just build-*` |
| Expo SDK upgrade | `expo` 55 → 56 | **no** | bump `version` → `just build-*` |

When you bump `version`, the new binary is on a new runtime channel; clients on the old `version` stop seeing your OTAs until they upgrade through the store.

### 4. Submit flow

```bash
# 1. Build prod (auto-increments buildNumber)
just build-ios --profile production

# 2. Submit the latest finished build
just submit-ios --profile production
```

`appVersionSource: "remote"` in `eas.json` makes EAS the authority for `buildNumber` / `versionCode` — local edits are ignored. This is why `autoIncrement: true` on the `production` profile is enough.

## Pre-OTA checklist

Before every `eas update`, run through these. Skip none.

- [ ] `bunx convex codegen` — generated types reflect the latest backend
- [ ] `just typecheck` — `tsc --noEmit` clean
- [ ] `just check` — Biome lint + format clean
- [ ] `bun test` — Jest passes
- [ ] `git diff main..HEAD -- package.json` shows no new entries that introduce native code
- [ ] `git diff main..HEAD -- app.config.ts` shows no plugin / permission / scheme change
- [ ] `runtimeVersion` (= `version` in `app.config.ts`) is unchanged since the last binary on this channel
- [ ] You are pushing to the right `--branch` / `--channel` (`development` vs `preview` vs `production`)
- [ ] `await Sentry.flush(2000)` exists before any `Updates.reloadAsync()` call in the diff (see `observability-sentry.md`)

If any item above fails, the answer is `eas build`, not `eas update`.

## Anti-Patterns

- **OTA-ing a native dep bump.** Adding `react-native-mmkv` and shipping via `eas update` without bumping `version` produces an immediate crash on launch (`TurboModuleRegistry.getEnforcing(...)` fails). The fix is to bump `version` in `app.config.ts:21` and run `just build-ios --profile production`.
- **Hand-editing `buildNumber` / `versionCode`.** `eas.json:4` sets `"appVersionSource": "remote"` — EAS owns these. Local edits are overwritten on the next build.
- **Sharing one bundle id across variants.** Removing `bundleSuffix` in `app.config.ts:8` collapses dev / preview / production into a single install slot; switching profiles requires uninstalling.
- **Wrong `--branch` on `eas update`.** A production-channel binary will not see a `--branch preview` update. There is no warning; clients just stay on the old JS.
- **Submitting without `autoIncrement`.** Without `eas.json:23` `"autoIncrement": true`, the store rejects with "build number already used."
- **Skipping the codegen step.** A stale `convex/_generated/api.d.ts` lets `tsc` pass against a backend that no longer matches; the OTA crashes at the first `useQuery`.

## Decision Rationale

- **`appVersionSource: "remote"`** forces EAS to manage build numbers so two engineers cannot collide on the same number locally.
- **Three profiles, three suffixes, three channels** isolates dev/preview/production traffic in Sentry, PostHog, and the stores' crashlytics — one profile cannot pollute another.
- **`policy: 'appVersion'`** picks the human-readable boundary over fingerprint hashing. A reviewer can answer "is this OTA safe?" by reading the PR's `package.json` and `app.config.ts` diff; no tooling required.
- **`just` recipes wrap every command.** No engineer should be memorizing `bunx eas update --branch ...` — the recipe is the contract.
