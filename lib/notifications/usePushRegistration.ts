import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth';
import { registerForPushNotificationsAsync } from './registerPushToken';

// The ref dedups React re-runs so registration fires once per user (a changed
// userId re-registers on a shared device). registerForPushNotificationsAsync
// prompts for permission and needs an authenticated session + a dev/standalone
// build — it returns 'unsupported' on web/simulator and swallows its own errors,
// so the `void` call can't crash the app. Move it to a contextual screen if you
// don't want to prompt at sign-in.
export function usePushRegistration(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      registeredFor.current = null;
      return;
    }
    if (registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPushNotificationsAsync();
  }, [userId]);
}
