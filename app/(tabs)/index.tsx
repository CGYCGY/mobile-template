import { useQuery } from 'convex/react';
import type { FunctionReference } from 'convex/server';
import { SafeAreaView } from 'react-native-safe-area-context';
import { H1, Paragraph, Spinner, YStack } from 'tamagui';
import { Button } from '@/components/ui/Button';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores';

type MeRow = {
  _id: string;
  authId: string;
  email: string;
  name: string;
  displayName?: string;
};

type UsersApi = {
  getMe: FunctionReference<
    'query',
    'public',
    Record<string, never>,
    MeRow | null
  >;
};

export default function HomeScreen() {
  const usersApi = api.users as unknown as UsersApi;
  const me = useQuery(usersApi.getMe);
  const cachedUser = useAuthStore((s) => s.user);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <YStack flex={1} padding="$4" gap="$4" backgroundColor="$background">
        <H1>Home</H1>
        {me === undefined ? (
          <Spinner />
        ) : me === null ? (
          <Paragraph color="$gray10">
            Signed in as {cachedUser?.email ?? 'unknown'} — profile not yet
            synced.
          </Paragraph>
        ) : (
          <YStack gap="$2">
            <Paragraph>
              <Paragraph fontWeight="600">Name: </Paragraph>
              {me.displayName ?? me.name}
            </Paragraph>
            <Paragraph color="$gray10">{me.email}</Paragraph>
          </YStack>
        )}
        <Button variant="secondary" onPress={() => {}}>
          Sample action
        </Button>
      </YStack>
    </SafeAreaView>
  );
}
