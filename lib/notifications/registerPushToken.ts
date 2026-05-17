import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/convex/_generated/api';
import { convexClient } from '@/lib/convex';

export type PushPlatform = 'ios' | 'android';

export type RegisterPushResult =
  | { type: 'registered'; token: string }
  | { type: 'denied' }
  | { type: 'unsupported' }
  | { type: 'error'; message: string };

export async function registerForPushNotificationsAsync(): Promise<RegisterPushResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { type: 'unsupported' };
  }

  const platform: PushPlatform = Platform.OS;

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const next = await Notifications.requestPermissionsAsync();
      status = next.status;
    }
    if (status !== 'granted') {
      return { type: 'denied' };
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;

    await convexClient.mutation(api.push.registerExpoPushToken, {
      token,
      platform,
    });

    return { type: 'registered', token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { type: 'error', message };
  }
}
