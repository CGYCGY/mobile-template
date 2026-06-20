import { usePathname } from 'expo-router';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { useEffect, useRef } from 'react';
import { env } from '@/env';
import { useAuthStore } from '@/stores/auth';

export const postHogProviderProps = {
  apiKey: env.EXPO_PUBLIC_POSTHOG_KEY,
  options: {
    host: env.EXPO_PUBLIC_POSTHOG_HOST,
    captureAppLifecycleEvents: true,
    captureScreens: false,
  },
} as const;

// Emits screen() on every route change and keeps the distinct id tied to the
// signed-in user (identify on sign-in, reset on sign-out — otherwise one user's
// anonymous id bleeds into the next on a shared device). Mount once inside the
// provider.
export function PostHogInstrumentation() {
  const posthog = usePostHog();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    if (pathname) posthog.screen(pathname);
  }, [posthog, pathname]);

  useEffect(() => {
    if (user) {
      if (identifiedId.current !== user.id) {
        posthog.identify(user.id, { email: user.email });
        identifiedId.current = user.id;
      }
    } else if (identifiedId.current !== null) {
      posthog.reset();
      identifiedId.current = null;
    }
  }, [posthog, user]);

  return null;
}

export { PostHogProvider, usePostHog };
