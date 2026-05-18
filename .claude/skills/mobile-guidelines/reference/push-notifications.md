---
name: push-notifications
description: Expo push notification wiring for this codebase - configureNotifications() once at startup, registerForPushNotificationsAsync for permission + token, Convex mutation keyed by userId for storage, and a Convex action that fans out via Expo's push API with DeviceNotRegistered cleanup.
---

# Push Notifications

## Purpose

This codebase uses Expo's managed push pipeline: native registration via `expo-notifications`, token storage in Convex keyed by user, and server-side fan-out from a Convex `action` that hits Expo's push API. Setup runs once at app startup so the foreground-presentation handler and Android channel are in place before the first notification can arrive. Permission, token acquisition, and Convex registration are bundled into a single `registerForPushNotificationsAsync` call that the auth flow invokes after sign-in. The project id is read from `Constants.expoConfig.extra.eas.projectId` - this is mandatory in the EAS build profile or `getExpoPushTokenAsync` returns a token tied to the wrong project.

## Patterns

### 1. `configureNotifications()` runs once at app startup

Sets the foreground notification handler and creates the Android default channel. Idempotent via a module-level `configured` flag. Call it at the top of `app/_layout.tsx` (or from a `useEffect` in the root layout, before auth state matters).

```ts
// lib/notifications/setup.ts
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

let configured = false;

export function configureNotifications(): void {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }
}
```

The Android channel must exist before the first notification - notifications without a registered channel are silently dropped on Android 8+.

### 2. Permission + token + Convex registration in one call

`registerForPushNotificationsAsync` is the single entry point the app uses after sign-in. It checks existing permissions, requests them if needed, falls back gracefully on denial, fetches the Expo token, and posts it to Convex.

```ts
// lib/notifications/registerPushToken.ts
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/convex/_generated/api';
import { convexClient } from '@/lib/convex';

export async function registerForPushNotificationsAsync(): Promise<RegisterPushResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { type: 'unsupported' };
  }
  const platform: PushPlatform = Platform.OS;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return { type: 'denied' };

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const token = tokenResponse.data;

  await convexClient.mutation(api.push.registerExpoPushToken, { token, platform });
  return { type: 'registered', token };
}
```

The discriminated `RegisterPushResult` (`registered | denied | unsupported | error`) makes callers handle every outcome explicitly - no silent failures, no `null` token sentinels.

### 3. Project id comes from `Constants.expoConfig.extra.eas.projectId`

The id is set in `app.config.ts` under `extra.eas.projectId` and read at runtime by `registerForPushNotificationsAsync`. Without it, `getExpoPushTokenAsync` may return a token for the wrong project (or fail entirely on bare EAS builds).

```ts
// app.config.ts
extra: {
  eas: {
    projectId: 'TODO-set-from-eas-init',
  },
},
```

Run `eas init` after forking to populate this value. The build will fail loudly if it's left as the placeholder.

### 4. Convex mutation persists `{userId, token, platform}`

Tokens are stored on a `pushTokens` table keyed by the authenticated user's `_id` - not by `authId`, because fan-out queries by `userId`. The mutation upserts: same token gets `patch`ed if user or platform changed, new tokens get `insert`ed.

```ts
// convex/push.ts
export const registerExpoPushToken = mutation({
  args: { token: v.string(), platform },
  handler: async (ctx, { token, platform: tokenPlatform }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const user = await ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', identity.subject))
      .unique();
    if (!user) throw new Error('User row not found - WorkOS webhook has not synced this user yet.');

    const existing = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();

    if (existing) {
      if (existing.userId !== user._id || existing.platform !== tokenPlatform) {
        await ctx.db.patch(existing._id, { userId: user._id, platform: tokenPlatform });
      }
      return existing._id;
    }
    return ctx.db.insert('pushTokens', {
      userId: user._id, token, platform: tokenPlatform, createdAt: Date.now(),
    });
  },
});
```

A sibling `removeExpoPushToken` mutation deletes by token (used on sign-out and on `DeviceNotRegistered` cleanup).

### 5. Server fan-out from a Convex `action`

Sending lives in `convex/push.ts` as an `action` (network I/O is not allowed in mutations). The action looks up the user's tokens via an `internalQuery`, builds Expo push messages, and POSTs to `exp.host`. For production hardening, switch the raw `fetch` to `expo-server-sdk`'s `Expo.chunkPushNotifications` so batches stay under the 100-message limit and so `DeviceNotRegistered` tickets can clear stale tokens.

```ts
// convex/push.ts
export const sendPushToUser = action({
  args: { userId: v.id('users'), title: v.string(), body: v.string(), data: v.optional(v.any()) },
  handler: async (ctx, { userId, title, body, data }) => {
    const tokens = await ctx.runQuery(internal.push.tokensForUser, { userId });
    if (tokens.length === 0) return { sent: 0 };

    const messages = tokens.map((row) => ({
      to: row.token, title, body, data, sound: 'default' as const,
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`Expo push send failed: ${res.status} ${res.statusText}`);
    return { sent: messages.length };
  },
});
```

When you swap to `expo-server-sdk`, handle the receipt for `DeviceNotRegistered` by calling `removeExpoPushToken({ token })` - dead tokens otherwise eat quota forever.

## Anti-Patterns

- **Calling `configureNotifications()` from a screen instead of root.** Each screen mount would re-run the handler setup (the `configured` flag at `lib/notifications/setup.ts:4` makes that a no-op, but the intent is wrong - it belongs in the root layout once).
- **Skipping the project id argument.** `Notifications.getExpoPushTokenAsync()` with no args works in Expo Go but returns the wrong token (or none) on EAS-built clients. Always pass `{ projectId }` when available - `registerForPushNotificationsAsync` at `lib/notifications/registerPushToken.ts:37` does this.
- **Storing tokens keyed by `authId` instead of `userId`.** Fan-out joins by `userId`; keying by `authId` forces an extra index lookup on every send. The mutation at `convex/push.ts:18` resolves `authId` -> `userId` once at registration time.
- **Treating `denied` and `error` the same.** `denied` is a user choice (no retry, no toast); `error` is an exception (retry, log). The `RegisterPushResult` union at `lib/notifications/registerPushToken.ts:9` forces the caller to discriminate.
- **`fetch` to `exp.host` from a `mutation`.** Convex mutations are deterministic and cannot do network I/O. Push sending must live in an `action` (see `convex/push.ts:85`).
- **No `DeviceNotRegistered` cleanup.** Once `expo-server-sdk` is wired in, the receipts must be inspected and `removeExpoPushToken` called for any `DeviceNotRegistered` token - otherwise stale devices accumulate forever.

## Decision Rationale

See `../decisions.md` for:

- Why permission, token, and Convex registration are bundled into a single call rather than three composable steps
- Why tokens are keyed by `userId` (the Convex doc id) rather than `authId` (the WorkOS subject)
- Why fan-out lives in a Convex `action` rather than an external worker
- Why the project id is read from `Constants.expoConfig.extra.eas.projectId` rather than an env var
