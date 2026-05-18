---
name: platform-differences
description: iOS vs Android divergences exercised in this codebase — Blur fallback, notification channels, and KeyboardAvoidingView behavior.
---

# Platform Differences

## Purpose

Most code in this codebase is platform-agnostic. The exceptions are documented here because each one has bitten a real release somewhere: Blur on Android is unreliable, Android requires an explicit notification channel before any local notification will display, and `KeyboardAvoidingView` needs a different `behavior` per platform to keep the input visible. Treat this file as the complete list — if you find yourself adding a fourth `Platform.OS` branch, surface it here.

## Patterns

### Blur — iOS-only, fallback on Android (locked decision)

```tsx
// components/ui/BlurCard.tsx
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet } from 'react-native';
import { YStack, type YStackProps } from 'tamagui';

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
    <YStack borderRadius="$4" overflow="hidden" /* ... */ {...rest}>
      <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
      <YStack padding="$4" gap="$3">
        {children}
      </YStack>
    </YStack>
  );
}
```

Rules:

- Never call `<BlurView>` directly in a screen. Always go through `BlurCard` (or a sibling wrapper that owns the same branch).
- The Android fallback is a high-opacity solid surface, not a no-op. Designs that depend on "seeing through" the blur must be reviewed on Android before merge.
- `tint` and `intensity` props are intentionally accepted on the Android branch and intentionally ignored — keep the API symmetric so callers do not need a `Platform.OS` check.

### Notifications — Android channel registration is mandatory

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

Rules:

- Call `configureNotifications()` exactly once at app start. The `configured` flag guards re-entry under fast refresh.
- Android 8+ silently drops notifications posted without a channel. The `'default'` channel must exist before the first `scheduleNotificationAsync` call.
- New channels (e.g. `'chat'`, `'alerts'`) belong in this file behind the same `Platform.OS === 'android'` branch — never inline at a call site.
- iOS does not need or accept channels; the branch is android-only by design.

### Keyboard handling — branch the `behavior` prop

`KeyboardAvoidingView` ships in React Native but has no single setting that works on both platforms: `padding` is correct on iOS, `height` is correct on Android. When you add a form screen, branch the prop and read the header offset:

```tsx
// pattern (use whenever a form sits above the keyboard)
import { KeyboardAvoidingView, Platform } from 'react-native';

<KeyboardAvoidingView
  style={{ flex: 1 }}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
>
  {/* form fields */}
</KeyboardAvoidingView>
```

Rules:

- Always set `behavior` — the default differs across RN versions and has shifted before.
- `keyboardVerticalOffset` compensates for the header/tab bar; tune per screen, do not hoist to a global constant.
- For nested scroll inside the avoiding view, use `ScrollView` with `keyboardShouldPersistTaps="handled"` so tapping a button does not just dismiss the keyboard.

## Anti-Patterns

None currently in this codebase. When reviewing changes, flag:

- A bare `<BlurView>` outside `components/ui/BlurCard.tsx`
- An `expo-notifications` schedule call made before `configureNotifications()` runs
- A `KeyboardAvoidingView` with a hard-coded `behavior` (either `"padding"` or `"height"`) and no `Platform.OS` branch
- A `Platform.OS` check in a screen that duplicates a branch already living in `lib/` or `components/ui/` — collapse it into the wrapper instead

## Decision Rationale

See `decisions.md` for:

- Why `BlurCard` ships an Android fallback rather than gating the entire feature
- Why notification setup is a singleton in `lib/notifications/` rather than per-screen
- Why platform branches live inside wrappers (`BlurCard`, `configureNotifications`) rather than at every call site
