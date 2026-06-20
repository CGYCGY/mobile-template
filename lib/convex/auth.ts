import { getTokens, refreshAccessToken } from '@/lib/auth';

// Dual-flight, keyed by mode: a forceRefreshToken:true call must NOT reuse a
// non-forced in-flight read, or a forced refresh hands back the same expired
// token Convex just rejected. The underlying refreshAccessToken is itself
// single-flighted, so concurrent forced callers still share one network refresh.
let inflightForced: Promise<string | null> | null = null;
let inflightRead: Promise<string | null> | null = null;

export async function fetchConvexAccessToken({
  forceRefreshToken,
}: {
  forceRefreshToken: boolean;
}): Promise<string | null> {
  if (forceRefreshToken) {
    if (inflightForced) return inflightForced;
    const task = refreshAccessToken().then((next) => next?.accessToken ?? null);
    inflightForced = task;
    try {
      return await task;
    } finally {
      inflightForced = null;
    }
  }

  if (inflightRead) return inflightRead;
  const task = (async () => {
    const tokens = await getTokens();
    if (!tokens) return null;
    if (Date.now() >= tokens.expiresAt) {
      const next = await refreshAccessToken();
      return next?.accessToken ?? null;
    }
    return tokens.accessToken;
  })();
  inflightRead = task;
  try {
    return await task;
  } finally {
    inflightRead = null;
  }
}
