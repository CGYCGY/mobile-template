import { Link, Stack } from 'expo-router';
import { H1, Paragraph, YStack } from 'tamagui';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="$4"
        padding="$6"
        backgroundColor="$background"
      >
        <H1>Screen not found</H1>
        <Paragraph color="$gray10">
          The screen you tried to open does not exist.
        </Paragraph>
        <Link href="/">Go home</Link>
      </YStack>
    </>
  );
}
