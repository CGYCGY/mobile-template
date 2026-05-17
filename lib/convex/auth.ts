import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '@/stores/auth';
import {
  getTokens,
  refreshAccessToken,
} from '@/lib/auth';
import { convexClient } from './client';

export function useConvexAuthBridge(): void {
  const user = useAuthStore((s) => s.user);
  const fetcher = useFetchConvexAccessToken();

  useEffect(() => {
    if (!user) {
      convexClient.clearAuth();
      return;
    }
    convexClient.setAuth(fetcher);
  }, [user, fetcher]);
}

function useFetchConvexAccessToken(): (args: {
  forceRefreshToken: boolean;
}) => Promise<string | null> {
  const inflight = useRef<Promise<string | null> | null>(null);

  return useCallback(async ({ forceRefreshToken }) => {
    if (inflight.current) return inflight.current;

    const task = (async () => {
      if (forceRefreshToken) {
        const next = await refreshAccessToken();
        return next?.accessToken ?? null;
      }
      const tokens = await getTokens();
      if (!tokens) return null;
      if (Date.now() >= tokens.expiresAt) {
        const next = await refreshAccessToken();
        return next?.accessToken ?? null;
      }
      return tokens.accessToken;
    })();

    inflight.current = task;
    try {
      return await task;
    } finally {
      inflight.current = null;
    }
  }, []);
}

export function useConvexClient() {
  return useMemo(() => convexClient, []);
}
