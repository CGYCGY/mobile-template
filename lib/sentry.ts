import * as Sentry from '@sentry/react-native';
import { env } from '@/env';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) return;
  initialized = true;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    enableAutoSessionTracking: true,
  });
}

export const wrap = Sentry.wrap;
export { Sentry };
