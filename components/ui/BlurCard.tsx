import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { YStack, type YStackProps } from 'tamagui';

type Props = YStackProps & {
  children: ReactNode;
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
};

// expo-blur on Android is unreliable; fall back to a translucent solid surface.
export function BlurCard({
  children,
  intensity = 40,
  tint = 'default',
  ...rest
}: Props) {
  if (Platform.OS === 'android') {
    return (
      <YStack
        backgroundColor="$background"
        opacity={0.92}
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
        padding="$4"
        {...rest}
      >
        {children}
      </YStack>
    );
  }

  return (
    <YStack
      borderRadius="$4"
      overflow="hidden"
      borderWidth={1}
      borderColor="$borderColor"
      {...rest}
    >
      <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
      <YStack padding="$4" gap="$3">
        {children}
      </YStack>
    </YStack>
  );
}
