import { Sentry } from './sentry';

type Meta = Record<string, unknown> | undefined;

function breadcrumb(level: 'info' | 'warning' | 'error', message: string, data: Meta): void {
  try {
    Sentry.addBreadcrumb({ level, message, data });
  } catch {
    // Sentry may not be initialized in dev — ignore.
  }
}

export const log = {
  info(message: string, meta?: Meta): void {
    // biome-ignore lint/suspicious/noConsole: dev-time logging surface
    console.info(message, meta ?? '');
    breadcrumb('info', message, meta);
  },
  warn(message: string, meta?: Meta): void {
    // biome-ignore lint/suspicious/noConsole: dev-time logging surface
    console.warn(message, meta ?? '');
    breadcrumb('warning', message, meta);
  },
  error(message: string | Error, meta?: Meta): void {
    if (message instanceof Error) {
      // biome-ignore lint/suspicious/noConsole: dev-time logging surface
      console.error(message, meta ?? '');
      try {
        Sentry.captureException(message, meta ? { extra: meta } : undefined);
      } catch {
        // ignore
      }
      return;
    }
    // biome-ignore lint/suspicious/noConsole: dev-time logging surface
    console.error(message, meta ?? '');
    breadcrumb('error', message, meta);
  },
};
