import * as Sentry from '@sentry/react-native';
import { env } from '@/env';

if (env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    enableAutoSessionTracking: true,
    integrations: [Sentry.reactNavigationIntegration()],
  });
}

export const wrap = Sentry.wrap;
export { Sentry };
