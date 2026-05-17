import { useState } from 'react';
import { H1, Paragraph, YStack } from 'tamagui';
import { Button } from '@/components/ui/Button';
import { signIn } from '@/lib/auth';

export default function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn();
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
