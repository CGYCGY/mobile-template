# Assets

These files are **placeholders** — 1x1 transparent PNGs — so Expo's build
toolchain doesn't choke on the references in `app.config.ts`. Replace before
shipping a real build.

## Expected dimensions

| File                 | Size        | Purpose                                                |
| -------------------- | ----------- | ------------------------------------------------------ |
| `icon.png`           | 1024 × 1024 | App icon (iOS + Android source).                       |
| `adaptive-icon.png`  | 1024 × 1024 | Android adaptive-icon foreground layer.                |
| `splash.png`         | 2048 × 2048 | Splash screen image (centered, transparent or solid).  |
| `favicon.png`        | 48 × 48     | Web favicon (only if you target Expo web).             |

See the Expo asset spec for exact requirements:
<https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/>

## Subdirectories

- `assets/fonts/` — custom font files loaded via `expo-font`.
- `assets/images/` — static images bundled with the app.
