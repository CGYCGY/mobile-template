import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { env } from '@/env';

export const postHogProviderProps = {
  apiKey: env.EXPO_PUBLIC_POSTHOG_KEY,
  options: {
    host: env.EXPO_PUBLIC_POSTHOG_HOST,
    captureAppLifecycleEvents: true,
    captureScreens: false,
  },
} as const;

export { PostHogProvider, usePostHog };
