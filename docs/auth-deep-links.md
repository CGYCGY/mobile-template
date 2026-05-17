# Auth Deep Links

This template ships with a **custom URL scheme** (`mobiletemplate://auth/callback`) for the WorkOS OAuth callback. It works out of the box: no DNS, no hosting, no associated-domain ceremony. For internal builds and TestFlight/Play internal tracks, custom scheme is fine.

For production — public TestFlight tracks, App Store, Play production — switch to **universal links (iOS) / app links (Android)**. They are HTTPS URLs that the OS routes to your app instead of Safari/Chrome, which closes a class of redirect-hijack attacks and stops the "open in browser" prompt that some users see on custom schemes.

## When to do this

Do the upgrade before you cut a build for an external audience (public TestFlight, App Store, Play production). Until then, the custom scheme is fine — keep both registered in WorkOS so you can flip back to scheme-only for local debugging.

## 1. Host `apple-app-site-association`

Serve this **without an `.json` extension**, at `https://yourdomain.com/.well-known/apple-app-site-association`, with `Content-Type: application/json` and no redirects.

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.com.example.mobiletemplate",
        "paths": ["/auth/callback", "/auth/callback?*"]
      }
    ]
  }
}
```

`TEAMID` is your Apple Developer team ID (visible in App Store Connect → Membership). `com.example.mobiletemplate` is the bundle identifier from `app.config.ts`.

## 2. Host `assetlinks.json`

Serve at `https://yourdomain.com/.well-known/assetlinks.json` with `Content-Type: application/json`.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.example.mobiletemplate",
      "sha256_cert_fingerprints": [
        "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"
      ]
    }
  }
]
```

The SHA256 fingerprint comes from the signing keystore EAS uses for the build. Pull it with:

```bash
bunx eas-cli credentials
```

Pick the Android profile, view the keystore, and copy the SHA256 line. If you build for multiple variants (`dev`, `preview`, `production`) each has its own fingerprint — list them all in `sha256_cert_fingerprints`.

## 3. Update `app.config.ts`

```ts
ios: {
  bundleIdentifier,
  associatedDomains: ['applinks:yourdomain.com'],
},
android: {
  package: bundleIdentifier,
  intentFilters: [
    {
      action: 'VIEW',
      autoVerify: true,
      data: [
        {
          scheme: 'https',
          host: 'yourdomain.com',
          pathPrefix: '/auth/callback',
        },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ],
},
```

Keep `scheme: 'mobiletemplate'` at the top level — the custom scheme stays usable for development.

## 4. Register the HTTPS redirect in WorkOS

In the WorkOS dashboard → Authentication → Redirects, add `https://yourdomain.com/auth/callback` alongside the existing `mobiletemplate://auth/callback`. Both must be present: the production build uses the HTTPS one, dev clients still use the scheme.

## 5. Switch `EXPO_PUBLIC_WORKOS_REDIRECT_URI`

In your production EAS profile (`eas.json` → `build.production.env` or via `bunx eas-cli secret:create`), set:

```
EXPO_PUBLIC_WORKOS_REDIRECT_URI=https://yourdomain.com/auth/callback
```

Leave `.env.local` pointing at the custom scheme for local dev.

## 6. Rebuild the dev client and test

Universal/app links only attach on **install** — a JS-only OTA update will not pick them up. You must rebuild and reinstall:

```bash
bunx eas-cli build --profile preview --platform ios
bunx eas-cli build --profile preview --platform android
```

Then verify deep-link routing on each platform.

**iOS simulator:**

```bash
xcrun simctl openurl booted "https://yourdomain.com/auth/callback?code=test"
```

If the link opens Safari instead of the app, the AASA is wrong or the app hasn't been reinstalled since the `associatedDomains` change. Check with:

```bash
xcrun simctl spawn booted log stream --predicate 'subsystem == "com.apple.swift.applinks"'
```

**Android emulator:**

```bash
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://yourdomain.com/auth/callback?code=test" \
  com.example.mobiletemplate
```

If it opens a browser, run `adb shell pm verify-app-links --re-verify com.example.mobiletemplate` and check `adb shell pm get-app-links com.example.mobiletemplate` — the domain should be `verified`.

## Failure modes

- **AASA cached aggressively.** Apple's CDN caches the AASA for hours. Bump a query param on the build, or wait it out.
- **`assetlinks.json` served as `text/html`.** App-link verification silently fails. Verify with `curl -I` that the content type is `application/json`.
- **Wrong SHA256.** EAS will sign each profile with a different keystore unless you've explicitly shared one. List every fingerprint in `assetlinks.json`.
