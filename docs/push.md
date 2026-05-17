# Push Notifications

This template uses `expo-notifications` on the client and the Expo Push Service (`https://exp.host/--/api/v2/push/send`) as the fan-out gateway to APNs (iOS) and FCM (Android). Sends originate from a Convex action so you can trigger them from any mutation or scheduled function.

You can swap the Expo Push Service for direct APNs/FCM later — the client side already obtains the OS-level token via `expo-notifications` — but the Expo gateway is fine for production and removes a pile of cert/auth machinery.

## 1. iOS — APNs key

1. Apple Developer portal → **Certificates, Identifiers & Profiles → Keys → +**.
2. Enable **Apple Push Notifications service (APNs)**. Download the `.p8` file (you get **one** download — keep the file).
3. Note the **Key ID** and your **Team ID**.
4. Upload to EAS:
   ```bash
   bunx eas-cli credentials
   ```
   Pick iOS → the relevant profile → **Push Notifications: Push Notifications Key** → **Set up a Push Notifications Key** → paste the `.p8`, Key ID, Team ID. EAS stores it and uses it for all future builds.

Once uploaded, the next dev-client/preview/production build will have push entitlements signed in.

## 2. Android — FCM v1 service account

The legacy FCM Server Key path is being deprecated by Google. Use FCM HTTP v1 with a service-account JSON.

1. Firebase Console → create (or open) a project. Add an Android app with package name `com.example.mobiletemplate` (or your variant suffix).
2. Download `google-services.json`. Put it at the repo root — `app.config.ts` will pick it up automatically on prebuild.
3. In Firebase Console → **Project settings → Service accounts → Generate new private key**. Download the JSON.
4. Upload to EAS:
   ```bash
   bunx eas-cli credentials
   ```
   Android → relevant profile → **FCM V1: Google Service Account Key** → upload the JSON.

EAS uses the service-account key when forwarding pushes through the Expo Push Service.

## 3. Permission request and token registration

The client-side flow (already implemented in `lib/notifications/registerPushToken.ts`):

1. On sign-in, ask the OS for notification permission (`Notifications.requestPermissionsAsync()`).
2. If granted, fetch the Expo push token (`Notifications.getExpoPushTokenAsync({ projectId })`). The `projectId` is the `extra.eas.projectId` from `app.config.ts`.
3. Send the token to a Convex mutation that stores it on the user row (or a `pushTokens` table if you need multi-device).

Tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. They are app-scoped and rotate when the app is reinstalled or the OS revokes notifications.

**Best time to ask:** right after a user action that contextualizes the prompt ("turn on alerts for new messages?"), not on first launch. The OS only lets you prompt once — a "no" persists until the user changes Settings manually.

## 4. Android channel setup

Android requires every notification to belong to a **channel** (Android 8+). Channels define the sound, vibration, and importance — and the user can mute them individually. Define them at app start, before any notification fires (handled in `lib/notifications/setup.ts`):

```ts
import * as Notifications from 'expo-notifications';

await Notifications.setNotificationChannelAsync('default', {
  name: 'General',
  importance: Notifications.AndroidImportance.DEFAULT,
  sound: 'default',
});
```

Add channels per category (e.g. `chat`, `marketing`) when you want users to be able to mute one without the other.

## 5. Sending a push from Convex

The action lives at `convex/push.ts` as `sendPushToUser`. It POSTs to the Expo Push API:

```ts
// convex/push.ts (sketch)
export const sendPushToUser = action({
  args: { userId: v.id('users'), title: v.string(), body: v.string() },
  handler: async (ctx, { userId, title, body }) => {
    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user?.pushToken) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: user.pushToken, title, body, sound: 'default' }),
    });
  },
});
```

Trigger it from a mutation:

```ts
await ctx.scheduler.runAfter(0, internal.push.sendPushToUser, {
  userId,
  title: 'New message',
  body: snippet,
});
```

`runAfter(0, ...)` decouples the send from the mutation's transaction — if the push API call fails, the mutation that triggered it still commits.

## 6. Testing pushes in dev

The Expo dashboard provides a manual sender at <https://expo.dev/notifications>. Paste the Expo push token (log it to console from `registerPushToken.ts` during dev), enter a title and body, send. The notification arrives on the device within a couple of seconds.

For local end-to-end tests, the Convex action can be invoked directly:

```bash
bunx convex run push:sendPushToUser '{"userId": "...", "title": "test", "body": "hi"}'
```

## Common failure modes

- **No token returned.** App is running in the simulator and you haven't granted notification permission, or the project isn't linked to Firebase/APNs. The simulator can receive pushes on iOS 16+ but not Android.
- **Tokens are stale.** Expo Push API returns `DeviceNotRegistered` for the token. Drop it from your DB and prompt the user to re-enable notifications.
- **Receipts ignored.** The Expo Push API returns *receipts* asynchronously for delivery confirmation. This template doesn't poll receipts (most apps don't need to). If you do, wire a Convex cron to `GET https://exp.host/--/api/v2/push/getReceipts`.

## References

- Expo Notifications: <https://docs.expo.dev/versions/latest/sdk/notifications/>
- Expo Push API: <https://docs.expo.dev/push-notifications/sending-notifications/>
- FCM HTTP v1: <https://firebase.google.com/docs/cloud-messaging/migrate-v1>
