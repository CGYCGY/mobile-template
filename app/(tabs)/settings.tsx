import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Avatar,
  H1,
  H3,
  Paragraph,
  Separator,
  ToggleGroup,
  XStack,
  YStack,
} from 'tamagui';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { signOut } from '@/lib/auth';
import { type Theme, useAuthStore, useUIStore } from '@/stores';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      clearAuth();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <YStack flex={1} padding="$4" gap="$5" backgroundColor="$background">
        <H1>Settings</H1>

        <XStack gap="$3" alignItems="center">
          <Avatar circular size="$6">
            {user?.avatarUrl ? (
              <Avatar.Image src={user.avatarUrl} />
            ) : null}
            <Avatar.Fallback backgroundColor="$gray6" />
          </Avatar>
          <YStack>
            <Paragraph fontWeight="600">
              {user?.displayName ?? user?.name ?? 'Unknown'}
            </Paragraph>
            <Paragraph color="$gray10">{user?.email}</Paragraph>
          </YStack>
        </XStack>

        <Separator />

        <YStack gap="$2">
          <H3>Theme</H3>
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(v) => {
              if (v) setTheme(v as Theme);
            }}
          >
            {THEMES.map((t) => (
              <ToggleGroup.Item key={t.value} value={t.value} aria-label={t.label}>
                <Paragraph>{t.label}</Paragraph>
              </ToggleGroup.Item>
            ))}
          </ToggleGroup>
        </YStack>

        <Separator />

        <Button variant="secondary" onPress={() => setSheetOpen(true)}>
          About
        </Button>

        <Button variant="destructive" onPress={handleSignOut} loading={signingOut}>
          Sign out
        </Button>
      </YStack>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <H3>About</H3>
        <Paragraph>
          Mobile Template — Expo Router + Tamagui + Convex.
        </Paragraph>
      </Sheet>
    </SafeAreaView>
  );
}
