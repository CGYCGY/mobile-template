import '@/lib/sentry';

import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Sentry } from '@/lib/sentry';
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
import { PostHogProvider, postHogProviderProps } from '@/lib/posthog';
import tamaguiConfig from '@/tamagui.config';

SplashScreen.preventAutoHideAsync().catch(() => {
  // splash may already be hidden in dev fast-refresh; safe to ignore
});

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  override render() {
    if (this.state.hasError) {
      return null;
    }
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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <RootErrorBoundary>
      <PostHogProvider {...postHogProviderProps}>
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
          <ThemeProvider value={DefaultTheme}>
            <ConvexProvider client={convexClient}>
              {/* testID is the e2e harness's "app rendered" signal: it appears only
                  past the fonts/splash gate and drops during a JS reload, which the
                  native activity (identical while bundling/reloading) cannot show. */}
              <GestureHandlerRootView testID="app-loaded" style={{ flex: 1 }}>
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
