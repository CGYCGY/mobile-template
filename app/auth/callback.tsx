import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Paragraph, Spinner, YStack } from 'tamagui';
import { completeSignIn } from '@/lib/auth';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; state?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await completeSignIn({ code: params.code, state: params.state });
        if (!cancelled) router.replace('/(tabs)');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Authentication failed');
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [params.code, params.state]);

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$6"
      backgroundColor="$background"
    >
      {error ? (
        <Paragraph color="$red10" textAlign="center">
          {error}
        </Paragraph>
      ) : (
        <>
          <Spinner size="large" />
          <Paragraph color="$gray10">Completing sign in…</Paragraph>
        </>
      )}
    </YStack>
  );
}
