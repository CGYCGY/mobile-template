import { router } from 'expo-router';
import { useState } from 'react';
import { H1, Paragraph, YStack } from 'tamagui';
import { Button } from '@/components/ui/Button';
import { completeSignIn, signIn } from '@/lib/auth';

export default function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      const result = await signIn();
      // On iOS the OAuth redirect is delivered through openAuthSessionAsync's
      // return value (no deep link fires), so the token exchange must happen
      // here. The auth/callback route only runs on Android's deep-link path.
      if (result.type === 'success') {
        await completeSignIn({ code: result.code, state: result.state });
        router.replace('/(tabs)');
      } else if (result.type === 'error') {
        setError(result.message);
      }
      // cancel/dismiss: the user backed out — leave the sign-in screen as-is.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$6"
      padding="$6"
      backgroundColor="$background"
    >
      <YStack gap="$2" alignItems="center">
        <H1>Mobile Template</H1>
        <Paragraph color="$gray10">Sign in to continue</Paragraph>
      </YStack>
      <Button onPress={handleSignIn} loading={loading} width="100%">
        Sign in with WorkOS
      </Button>
      {error ? (
        <Paragraph color="$red10" textAlign="center">
          {error}
        </Paragraph>
      ) : null}
    </YStack>
  );
}
