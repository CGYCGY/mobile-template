# EAS — Build, Submit, Update

EAS (Expo Application Services) is the build farm, signing-cert manager, store-submission pipeline, and OTA-update server. This template uses all four. The configuration lives in `eas.json`; the CLI is `eas-cli`.

## Profiles

`eas.json` defines three build profiles. Each is a different combination of bundle identifier, distribution method, channel, and env vars.

| Profile       | Bundle ID suffix | Distribution | Channel       | Use for                                            |
|---------------|------------------|--------------|---------------|----------------------------------------------------|
| `development` | `.dev`           | internal     | `development` | Custom dev client. See [dev-client.md](dev-client.md). |
| `preview`     | `.preview`       | internal     | `preview`     | Internal QA, TestFlight internal, Play internal track. |
| `production`  | (none)           | store        | `production`  | App Store / Play production listings.              |

The bundle-ID suffix means all three can coexist on a single device — `MyApp.dev`, `MyApp.preview`, and `MyApp` install side by side and don't share data.

The `APP_VARIANT` env var is read in `app.config.ts` to pick the suffix at build time.

## First-time configuration

```bash
bunx eas-cli login
bunx eas-cli init                  # creates EAS project, writes projectId
bunx eas-cli build:configure       # one-time platform setup (creates initial keystore/cert config)
bunx eas-cli credentials           # interactive: view/manage signing certs and keystores
```

`build:configure` is idempotent — running it after the fact won't break anything, but you usually only need it once.

## Channels and OTA updates

`expo-updates` is wired in. A build belongs to a **channel** (set in `eas.json` per profile). When you publish an OTA update, you push it to a channel; every installed build on that channel picks it up on next launch (or via `Updates.checkForUpdateAsync()` if you wire that explicitly).

```bash
bunx eas-cli update --channel production --message "Fix onboarding crash"
bunx eas-cli update --channel preview --message "QA build with new flow"
```

OTA updates can ship **only JS, image, and font assets**. Native changes (new package, plugin change, SDK bump) require a fresh build. If `runtimeVersion` in `app.config.ts` changes, the new OTA is incompatible with old binaries and won't be delivered to them — the user is told to update via the store.

This template uses `runtimeVersion.policy: 'appVersion'`, which means every `version` bump in `app.config.ts` cuts a new OTA cohort. Bump `version` when you ship a native change; otherwise leave it and OTAs keep flowing.

## Signing credentials

```bash
bunx eas-cli credentials
```

is the menu for everything signing-related. For each platform + profile combination it shows:

- **iOS**: distribution certificate, provisioning profile, push key (APNs).
- **Android**: upload keystore, FCM server key (legacy) or FCM v1 service account JSON.

EAS can generate and store all of these for you on first build. You only need to interact with this menu when:

- Migrating credentials from a different account.
- Rotating an expired certificate.
- Uploading the APNs key or FCM service account JSON (see [push.md](push.md)).

Pulling a SHA256 fingerprint for [assetlinks.json](auth-deep-links.md): also lives in this menu, under the Android profile.

## Submission

Submit production builds to the stores with:

```bash
bunx eas-cli submit --profile production --platform ios
bunx eas-cli submit --profile production --platform android
```

EAS reads `submit.production` in `eas.json` for the store credentials.

**iOS prerequisites:**

- Apple Developer Program membership ($99/yr).
- App registered in App Store Connect with the matching bundle identifier (`com.example.mobiletemplate`).
- `submit.production.ios.appleId`, `ascAppId`, and `appleTeamId` filled in (`eas.json` ships with `TODO` placeholders).
- The build must be a `production` profile build (not `preview` — different bundle ID).

**Android prerequisites:**

- Google Play Console account ($25 one-time).
- App created in Play Console with the matching package name.
- A Google service-account JSON with the `Service Account User` role and "Release Manager" permission in Play Console.
- Save the JSON as `google-service-account.json` in the project root (gitignored) — the path is referenced in `eas.json`.
- Track defaults to `internal`; bump to `production` when ready to roll out.

## `appVersionSource: "remote"`

`eas.json` sets `cli.appVersionSource: "remote"`. This means **EAS manages `versionCode` (Android) and `buildNumber` (iOS) on its servers**, auto-incrementing per build. You only manage the marketing `version` field in `app.config.ts`.

The benefit: no more "I forgot to bump the build number" submission failures. The cost: build numbers are sequential per EAS project, not per local checkout, so they may jump (and that's fine — they only need to monotonically increase per platform).

## Secrets

Build-time secrets (Sentry auth token, API keys needed during sourcemap upload, etc.) live as EAS secrets, not in `.env.local`:

```bash
bunx eas-cli secret:create --scope project --name SENTRY_AUTH_TOKEN --value sntrys_...
bunx eas-cli secret:list
bunx eas-cli secret:delete --id <id>
```

Anything in `process.env` during a build comes from one of three sources, in order of precedence: shell env → EAS secrets → `eas.json` `build.<profile>.env`. Runtime env vars (anything the app reads at runtime, like `EXPO_PUBLIC_*`) are baked into the bundle at build time — they cannot be EAS secrets; put them in `eas.json` `env` or `.env.local`.

## Useful references

- EAS Build: <https://docs.expo.dev/build/introduction/>
- EAS Update: <https://docs.expo.dev/eas-update/introduction/>
- EAS Submit: <https://docs.expo.dev/submit/introduction/>
- `eas.json` reference: <https://docs.expo.dev/build-reference/eas-json/>
