import { useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import { fetchConvexAccessToken } from './auth';

// Shape matches ConvexProviderWithAuth's `useAuth` contract:
// { isLoading, isAuthenticated, fetchAccessToken }. Pass this as the provider's
// useAuth prop so Convex drives token fetch/refresh off the app's auth store.
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      fetchConvexAccessToken({ forceRefreshToken }),
    [],
  );

  return {
    isLoading,
    isAuthenticated: !!user,
    fetchAccessToken,
  };
}
