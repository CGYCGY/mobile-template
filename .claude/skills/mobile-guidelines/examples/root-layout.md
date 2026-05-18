---
name: example-root-layout
description: Annotated walkthrough of app/_layout.tsx — the canonical provider stack and Sentry wiring for this codebase.
---

# Example: Root Layout

The root layout sets up the entire provider tree, Sentry, splash screen, and the top-level Stack. It is the single most opinionated file in the codebase; reproduce its shape when starting a new app.

## File

```tsx
// app/_layout.tsx
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { ConvexProvider } from 'convex/react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Component, type ReactNode, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { convexClient } from '@/lib/convex';
import { PostHogProvider } from '@/lib/posthog';
import tamaguiConfig from '@/tamagui.config';

// ⚠️ Sentry.init({...}) belongs HERE at module scope (currently absent;
// see decisions.md → "Sentry initialization"). Init must run before React
// renders so early errors are captured.

SplashScreen.preventAutoHideAsync().catch(() => {
  // splash may already be hidden in dev fast-refresh; safe to ignore
});

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(error: Error, info: { componentStack?: string }) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }
  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({});

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <RootErrorBoundary>
      <PostHogProvider>
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
          <ThemeProvider value={DefaultTheme}>
            <ConvexProvider client={convexClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeAreaProvider>
                  <StatusBar style="auto" />
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(auth)" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="auth/callback" />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                </SafeAreaProvider>
              </GestureHandlerRootView>
            </ConvexProvider>
          </ThemeProvider>
        </TamaguiProvider>
      </PostHogProvider>
    </RootErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
```

## Patterns demonstrated

- ✓ **Provider order** — RootErrorBoundary → PostHog → Tamagui → Theme → Convex → Gesture → SafeArea → Stack. See `decisions.md` → "Provider wrap order".
- ✓ **`Sentry.wrap`** on the default export so the navigation container is instrumented automatically.
- ✓ **Font-gated render** — return `null` while fonts load to keep the splash visible. No layout shift on first paint.
- ✓ **Inline error boundary** with `Sentry.captureException` in `componentDidCatch`.
- ✓ **Explicit Stack screens** named per top-level route group — Expo Router can infer these, but listing them makes deep-link debugging easier.
- ✓ **Swallowed promise** carries a `// ignore: <reason>` comment so reviewers don't flag it.

## Anti-patterns called out

- ⚠️ **No module-scope `Sentry.init`** at the top of this file (currently). Fix: lift `Sentry.init({ dsn: env.SENTRY_DSN, integrations: [Sentry.reactNavigationIntegration(...)] })` to module scope.
- ⚠️ **`useConvexAuthBridge` is not mounted here** — and it shouldn't be (this file runs before auth). Mount it inside `app/(tabs)/_layout.tsx`. See `examples/auth-gated-tabs.md`.

## Where to extend

- Add new top-level screens by adding files under `app/` and (optionally) listing them in `<Stack>`.
- Add app-wide context providers by inserting them between Tamagui and Convex (theme-aware) or above PostHog (event-aware).
