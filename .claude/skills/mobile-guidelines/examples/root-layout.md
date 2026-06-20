---
name: example-root-layout
description: Annotated walkthrough of app/_layout.tsx — the canonical provider stack, dynamic theme, root Convex auth provider, PostHog instrumentation, and raw-RN error fallback for this codebase.
---

# Example: Root Layout

The root layout sets up the entire provider tree, Sentry, the dynamic theme, the root Convex auth provider, auth bootstrap, splash screen, and the top-level Stack. It is the single most opinionated file in the codebase; reproduce its shape when starting a new app.

## File

```tsx
// app/_layout.tsx
import '@/lib/sentry'; // first line: module-scope Sentry.init runs before render

import { ConvexProviderWithAuth } from 'convex/react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Component, type ReactNode, useEffect } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider, Theme } from 'tamagui';
import { useAuthBootstrap } from '@/lib/auth';
import { convexClient, useAuth } from '@/lib/convex';
import {
  PostHogInstrumentation,
  PostHogProvider,
  postHogProviderProps,
} from '@/lib/posthog';
import { Sentry } from '@/lib/sentry';
import { useUIStore } from '@/stores/ui';
import tamaguiConfig from '@/tamagui.config';

SplashScreen.preventAutoHideAsync().catch(() => {
  // splash may already be hidden in dev fast-refresh; safe to ignore
});

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(error: Error, info: { componentStack?: string }) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }
  override render() {
    if (this.state.hasError) {
      // Wraps TamaguiProvider → raw RN + hex only (a Tamagui fallback would
      // re-throw if the crash IS a provider failure).
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#15130f' }}>
          <Text style={{ color: '#f7f4ee', fontSize: 18, fontWeight: '600' }}>Something went wrong</Text>
          <Pressable onPress={() => this.setState({ hasError: false })} style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#d97757' }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({});
  const themePref = useUIStore((s) => s.theme);
  const systemScheme = useColorScheme();
  const effectiveTheme: 'light' | 'dark' =
    themePref === 'system'
      ? systemScheme === 'dark' ? 'dark' : 'light'
      : themePref;

  // Rehydrate the auth store from stored tokens on cold start; without this a
  // returning user appears signed out despite valid tokens.
  useAuthBootstrap();

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <RootErrorBoundary>
      <PostHogProvider {...postHogProviderProps}>
        <PostHogInstrumentation />
        {/* Tamagui v2 needs an explicit <Theme> wrapper; defaultTheme alone
            is not enough for correct propagation. */}
        <TamaguiProvider config={tamaguiConfig} defaultTheme={effectiveTheme}>
          <Theme name={effectiveTheme}>
            <ConvexProviderWithAuth client={convexClient} useAuth={useAuth}>
              <GestureHandlerRootView testID="app-loaded" style={{ flex: 1 }}>
                <SafeAreaProvider>
                  <StatusBar style={effectiveTheme === 'dark' ? 'light' : 'dark'} />
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(auth)" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="auth/callback" />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                </SafeAreaProvider>
              </GestureHandlerRootView>
            </ConvexProviderWithAuth>
          </Theme>
        </TamaguiProvider>
      </PostHogProvider>
    </RootErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
```

## Patterns demonstrated

- ✓ **Module-scope Sentry init** — `import '@/lib/sentry'` is the **first line**, so `Sentry.init` runs before any component renders. The DSN is `EXPO_PUBLIC_SENTRY_DSN` and the integration is `expoRouterIntegration()` (see `reference/observability-sentry.md`).
- ✓ **Provider order** — RootErrorBoundary → PostHog (+ `PostHogInstrumentation`) → Tamagui → `<Theme>` → `ConvexProviderWithAuth` → Gesture → SafeArea → Stack. See `decisions.md` → "Provider wrap order".
- ✓ **Root Convex auth** — `ConvexProviderWithAuth` is mounted **here at the root**, driven by `useAuth()`. Convex fetches a token only once `isAuthenticated` is true, so root mounting is safe (no pre-auth `/authenticate` storm). There is no `useConvexAuthBridge`.
- ✓ **`useAuthBootstrap()` is actually called here** — it rehydrates the auth store from SecureStore on cold start so a returning user isn't shown as signed out.
- ✓ **Dynamic theme** — derived from `useUIStore((s) => s.theme)` + `useColorScheme()`, applied via both `TamaguiProvider defaultTheme` and the required `<Theme name={...}>` wrapper, and mirrored on `<StatusBar>`.
- ✓ **`PostHogInstrumentation`** mounted inside the provider — handles `screen()` / `identify()` / `reset()` (see `reference/observability-posthog.md`).
- ✓ **Raw-RN error fallback** — `RootErrorBoundary` renders a "Try again" View/Text/Pressable with hex colors because it wraps `TamaguiProvider`. See `reference/error-handling.md`.
- ✓ **`Sentry.wrap`** on the default export so routing breadcrumbs and `expoRouterIntegration` work.
- ✓ **Font-gated render** — return `null` while fonts load to keep the splash visible.
- ✓ **`testID="app-loaded"`** on `GestureHandlerRootView` is the e2e "app rendered" signal.

## Anti-patterns called out

- ⚠️ **Tamagui in the error fallback.** The boundary wraps `TamaguiProvider`; a Tamagui-based fallback would re-throw on a provider crash. Keep it raw RN + hex.
- ⚠️ **A per-layout `useConvexAuthBridge()` / `convexClient.setAuth(...)`.** Token fetch is owned by the root `ConvexProviderWithAuth` + `useAuth()`. Do not add a second mount point in `(tabs)/_layout.tsx` or anywhere else.
- ⚠️ **Dropping the `<Theme>` wrapper or `import '@/lib/sentry'` from the top.** The first breaks theme propagation in v2; the second means Sentry never initializes before render.

## Where to extend

- Add new top-level screens by adding files under `app/` and (optionally) listing them in `<Stack>`.
- Add app-wide context providers by inserting them between `<Theme>` and `ConvexProviderWithAuth` (theme-aware) or above `PostHogProvider` (event-aware).
