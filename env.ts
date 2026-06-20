import * as z from 'zod';

const clientSchema = z.object({
  EXPO_PUBLIC_CONVEX_URL: z.string().url(),
  EXPO_PUBLIC_WORKOS_CLIENT_ID: z.string().min(1),
  EXPO_PUBLIC_WORKOS_REDIRECT_URI: z
    .string()
    .min(1)
    .default('mobiletemplate://auth/callback'),
  EXPO_PUBLIC_POSTHOG_KEY: z.string().min(1),
  EXPO_PUBLIC_POSTHOG_HOST: z
    .string()
    .url()
    .default('https://us.i.posthog.com'),
  // DSNs are not secrets; must be EXPO_PUBLIC_ to be inlined by babel-preset-expo
  EXPO_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
});

const buildSchema = z.object({
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
});

const clientRuntime = {
  EXPO_PUBLIC_CONVEX_URL: process.env.EXPO_PUBLIC_CONVEX_URL,
  EXPO_PUBLIC_WORKOS_CLIENT_ID: process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID,
  EXPO_PUBLIC_WORKOS_REDIRECT_URI: process.env.EXPO_PUBLIC_WORKOS_REDIRECT_URI,
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
};

const emptyToUndefined = (v: string | undefined) => (v === '' ? undefined : v);

const buildRuntime = {
  SENTRY_AUTH_TOKEN: emptyToUndefined(process.env.SENTRY_AUTH_TOKEN),
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
  const message =
    `Invalid environment variables:\n${issues.join('\n')}\n` +
    'Set the missing/invalid keys in your .env file or EAS secrets.';
  // eas-cli introspects the config without loading .env files — via
  // EXPO_NO_DOTENV=1 subprocesses AND in-process @expo/config reads (where
  // only argv identifies it). Values are injected on the EAS build servers
  // instead, so a throw here would break every local `eas` command.
  const underEasCli =
    !!process.env.EXPO_NO_DOTENV ||
    (process.argv[1] ?? '')
      .split(/[\\/]/)
      .some((seg) => seg === 'eas' || seg === 'eas-cli');
  if (underEasCli) {
    console.warn(message);
  } else {
    throw new Error(message);
  }
}

export const env = {
  ...(clientResult.success
    ? clientResult.data
    : ({} as z.infer<typeof clientSchema>)),
  ...(buildResult.success
    ? buildResult.data
    : ({} as z.infer<typeof buildSchema>)),
};

export type Env = typeof env;
