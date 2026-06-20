import { Redirect, Tabs } from 'expo-router';
import { Spinner, YStack } from 'tamagui';
import { Home, Settings } from '@/components/icons';
import { useAuthStore } from '@/stores';

export default function TabsLayout() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  // While bootstrap is still resolving stored tokens, hold on a spinner rather
  // than redirecting — otherwise a returning user briefly flashes the sign-in
  // screen before their session rehydrates.
  if (isLoading && !user) {
    return (
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$background"
      >
        <Spinner size="large" />
      </YStack>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Settings color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
