import '@/lib/sentry';

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
  configureNotifications,
  usePushRegistration,
} from '@/lib/notifications';
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
      // This boundary wraps TamaguiProvider, so the fallback can't use Tamagui
      // tokens/components — a provider crash would re-throw. Raw RN + hex only.
      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            backgroundColor: '#15130f',
          }}
        >
          <Text style={{ color: '#f7f4ee', fontSize: 18, fontWeight: '600' }}>
            Something went wrong
          </Text>
          <Pressable
            onPress={() => this.setState({ hasError: false })}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: '#d97757',
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>
              Try again
            </Text>
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
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : themePref;

  // Rehydrate the auth store from stored tokens on cold start; without this a
  // returning user appears signed out despite valid tokens.
  useAuthBootstrap();
  usePushRegistration();

  useEffect(() => {
    configureNotifications();
  }, []);

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
        <PostHogInstrumentation />
        {/* Tamagui v2 needs an explicit <Theme> wrapper for correct theme
            propagation; defaultTheme alone is not enough. */}
        <TamaguiProvider config={tamaguiConfig} defaultTheme={effectiveTheme}>
          <Theme name={effectiveTheme}>
            <ConvexProviderWithAuth client={convexClient} useAuth={useAuth}>
              {/* testID is the e2e harness's "app rendered" signal: it appears only
                  past the fonts/splash gate and drops during a JS reload, which the
                  native activity (identical while bundling/reloading) cannot show. */}
              <GestureHandlerRootView testID="app-loaded" style={{ flex: 1 }}>
                <SafeAreaProvider>
                  <StatusBar
                    style={effectiveTheme === 'dark' ? 'light' : 'dark'}
                  />
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
