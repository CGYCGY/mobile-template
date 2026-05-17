import PostHog, { PostHogProvider } from 'posthog-react-native';
import { env } from '@/env';

export const posthog = new PostHog(env.EXPO_PUBLIC_POSTHOG_KEY, {
  host: env.EXPO_PUBLIC_POSTHOG_HOST,
});

export type PostHogProps = {
  apiKey: string;
  host: string;
  autocapture: boolean;
};

export const postHogProviderProps: PostHogProps = {
  apiKey: env.EXPO_PUBLIC_POSTHOG_KEY,
  host: env.EXPO_PUBLIC_POSTHOG_HOST,
  autocapture: true,
};

export function track(
  event: string,
  props?: Record<string, unknown>,
): void {
  posthog.capture(event, props);
}

export { PostHogProvider };
