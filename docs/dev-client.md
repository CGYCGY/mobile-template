# Dev Client

**Expo Go does not work with this template.** You must build a custom dev client.

## Why

Expo Go bundles a fixed set of native modules. This template depends on several modules that are not in that set:

- `react-native-quick-crypto` — JSI-backed crypto used by the WorkOS PKCE flow.
- `@sentry/react-native` — native crash reporter with platform hooks.
- `react-native-mmkv` — JSI-backed key/value store used by the Zustand persist layer.
- `react-native-reanimated` (+ Tamagui driver) — the Reanimated worklet runtime is included in Expo Go, but Tamagui's animation driver needs the Babel plugin to run at build time.
- `expo-secure-store` — Keychain/Keystore bridge for the WorkOS refresh token.

Trying to run this template in Expo Go produces "Native module X is null" at startup. There is no workaround inside Expo Go — the only path forward is a dev client.

## What a dev client is

A dev client is an app **you** build that bundles your chosen native modules. It includes a JS bridge that loads JS from your local Metro server (just like Expo Go), so the inner loop — edit a `.tsx` file, save, hot reload — is unchanged. You only need a new dev-client build when the **native** surface changes: adding a new library that ships native code, bumping `expo` SDK, editing `app.config.ts` plugins.

## First-time setup

```bash
bunx eas-cli login
bunx eas-cli init        # creates the EAS project, writes projectId into app.config.ts
```

Replace the `TODO-set-from-eas-init` and `TODO-project-id` placeholders that `eas init` doesn't fill in automatically (`extra.eas.projectId` and `updates.url` — `eas-cli` will offer to do this for you on first build).

## Build the dev client

```bash
# iOS (physical device or simulator with --profile development-simulator if you add one)
bunx eas-cli build --profile development --platform ios

# Android (APK)
bunx eas-cli build --profile development --platform android
```

The first cloud build typically takes 15–25 min: EAS provisions a macOS / Linux worker, installs CocoaPods or Gradle deps, compiles the native modules, and signs the bundle. Subsequent builds with the same native graph are faster (cached).

When EAS finishes it prints a URL — install the `.ipa` on the device/simulator (drag to simulator window, or scan the QR for a device) or the `.apk` (`adb install`).

## Local builds (no EAS worker)

If you have Xcode (with command-line tools) and Android Studio set up locally, you can build without EAS workers:

```bash
bunx eas-cli build --local --profile development --platform ios
bunx eas-cli build --local --profile development --platform android
```

Local builds are free and faster after the first run, but require the full native toolchain on your machine. EAS Build is the easier path until you find yourself rebuilding multiple times a day.

## Simulator builds

iOS simulator builds need a different profile because the signing config differs (no provisioning profile). Add to `eas.json`:

```json
"development-simulator": {
  "developmentClient": true,
  "distribution": "internal",
  "channel": "development",
  "ios": { "simulator": true },
  "env": { "APP_VARIANT": "dev" }
}
```

Then:

```bash
bunx eas-cli build --profile development-simulator --platform ios
```

Drag the resulting `.app` into the running simulator window to install.

## Daily workflow

Once the dev client is installed:

```bash
bun start
```

Open the installed dev-client app (not Expo Go) and either scan the QR or paste the dev-server URL. JS changes hot-reload in milliseconds. The native bundle is fixed until you rebuild.

## When to rebuild the dev client

Rebuild when **any of**:

- A new dependency that ships native code is added (`bun add react-native-foo`).
- A dependency that ships native code is bumped to a version with a different native API.
- `app.config.ts` plugins change (add/remove a plugin, change plugin config).
- `expo` SDK is bumped.
- iOS deployment target or Android `minSdkVersion` changes.

For pure JS / TypeScript edits, the running dev client picks up changes automatically.

## Prebuild and the `ios/` / `android/` directories

`bun run prebuild` (or `bunx eas-cli build` on a fresh checkout) runs Expo's prebuild step, which generates native `ios/` and `android/` project directories from `app.config.ts`. **Those directories are gitignored** in this template — the source of truth is `app.config.ts` and the plugins it lists. If you find yourself editing files inside `ios/` or `android/` directly, stop: write an Expo config plugin instead, otherwise the next prebuild will silently wipe your change.
