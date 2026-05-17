import * as z from 'zod';

const clientSchema = z.object({
  EXPO_PUBLIC_CONVEX_URL: z.string().url(),
  EXPO_PUBLIC_WORKOS_CLIENT_ID: z.string().min(1),
  EXPO_PUBLIC_WORKOS_REDIRECT_URI: z
    .string()
    .min(1)
    .default('mobiletemplate://auth/callback'),
  EXPO_PUBLIC_POSTHOG_KEY: z.string().min(1),
  EXPO_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
});

const buildSchema = z.object({
  SENTRY_DSN: z.string().min(1).optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
});

const clientRuntime = {
  EXPO_PUBLIC_CONVEX_URL: process.env.EXPO_PUBLIC_CONVEX_URL,
  EXPO_PUBLIC_WORKOS_CLIENT_ID: process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID,
  EXPO_PUBLIC_WORKOS_REDIRECT_URI: process.env.EXPO_PUBLIC_WORKOS_REDIRECT_URI,
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
};

const buildRuntime = {
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
};

const clientResult = clientSchema.safeParse(clientRuntime);
const buildResult = buildSchema.safeParse(buildRuntime);

if (!clientResult.success || !buildResult.success) {
  const issues: string[] = [];
  if (!clientResult.success) {
    for (const i of clientResult.error.issues) {
      issues.push(`  - ${i.path.join('.')}: ${i.message}`);
    }
  }
  if (!buildResult.success) {
    for (const i of buildResult.error.issues) {
      issues.push(`  - ${i.path.join('.')}: ${i.message}`);
    }
  }
  throw new Error(
    `Invalid environment variables:\n${issues.join('\n')}\n` +
      'Set the missing/invalid keys in your .env file or EAS secrets.',
  );
}

export const env = {
  ...clientResult.data,
  ...buildResult.data,
};

export type Env = typeof env;
