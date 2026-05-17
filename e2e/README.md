# E2E tests (Maestro)

Maestro drives the installed dev-variant app against an emulator, simulator, or
physical device. Flows are plain YAML — no JS toolchain, no Appium.

## Prerequisites

Install the Maestro CLI:

```sh
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Then either:

- iOS: boot a Simulator (`xcrun simctl boot "iPhone 15"`), or attach a device.
- Android: start an emulator (`emulator -avd <name>`), or attach a device with
  USB debugging enabled.

Install the **dev variant** of the app on the target — that's what `appId:
com.example.mobiletemplate.dev` in the flows resolves to. From this directory:

```sh
APP_VARIANT=dev bun run ios     # or `android`
```

## Running flows

Run the whole suite:

```sh
maestro test e2e/
```

Run one flow:

```sh
maestro test e2e/smoke.yaml
```

Screenshots produced by `takeScreenshot:` land in `~/.maestro/tests/<run-id>/`.

## Recording new flows

`maestro studio` opens an interactive UI that mirrors the device and lets you
generate YAML by tapping. Save the output into this directory.

```sh
maestro studio
```

## Auth mock

The real sign-in flow opens an external browser via `expo-web-browser`, which
Maestro can't reliably automate across platforms. `sign-in.yaml` sets
`EXPO_PUBLIC_E2E_MOCK_AUTH=1`, which the auth boundary in `lib/auth/` reads to
short-circuit to a stubbed session. Mirror that check in any new flow that
needs an authenticated user.
