---
name: tamagui-patterns
description: Tokens-only styling rules for this codebase. Tamagui is the single source of truth - no StyleSheet, no raw hex, no raw px on layout props. Covers token usage, variant patterns, when to reach for styled() vs inline props, and platform-specific style props.
---

# Tamagui Patterns

## Purpose

Tamagui is the single styling source in this codebase. Every color, spacing, radius, font size and breakpoint flows through theme tokens defined by `@tamagui/config/v5` and re-exported from `tamagui.config.ts`. The compiler can only flatten and optimize style props when you stay inside the token system — raw values bypass it and silently break dark mode, theming, and runtime perf.

Use this doc when you author or review any component that sets a visual property.

**Tamagui v2 config facts (`tamagui.config.ts`):**
- Base config is `@tamagui/config/v5`; the `animations` driver is wired separately from `@tamagui/config/v5-reanimated` (v2 unbundles animations from the config).
- `settings.onlyAllowShorthands: false` is set. Tamagui v2 rejects longhand style props (`backgroundColor`, `alignItems`, …) by default; this codebase uses longhands, so they are re-enabled. Both longhands and shorthands work here.
- The animation prop on components was renamed `animation` → `transition` (e.g. `components/ui/Sheet.tsx` takes a `transition` prop and passes `transition="lazy"` to the overlay).
- A `<Theme name={effectiveTheme}>` wrapper at the root is required for correct theme propagation in v2 — `defaultTheme` on the provider alone is not enough.
- The `@tamagui/babel-plugin` extractor runs **only in production** (`disableExtraction: NODE_ENV !== 'production'` in `babel.config.js`): under jest the v2 extractor's injected runtime hits uninitialized state and throws, so it stays off everywhere but production builds.

## Patterns

### 1. Tokens-only style props

Always use `$`-prefixed tokens for color, spacing, radius, and font size. Numeric layout values (`p={16}`, `gap={8}`) should also become tokens (`p="$4"`, `gap="$2"`) so they stay in the design scale.

```tsx
// components/ui/Button.tsx
const variantStyles: Record<Variant, Partial<ButtonProps>> = {
  primary: {
    backgroundColor: '$blue10',
    color: 'white',
    pressStyle: { backgroundColor: '$blue11' },
    hoverStyle: { backgroundColor: '$blue11' },
  },
  // ...
};
```

```tsx
// app/(auth)/sign-in.tsx
<YStack
  flex={1}
  alignItems="center"
  justifyContent="center"
  gap="$6"
  padding="$6"
  backgroundColor="$background"
>
```

Acceptable scalar values: `flex`, `opacity`, numeric `borderWidth={1}`, and aspect ratios. Everything else (`padding`, `margin`, `gap`, `borderRadius`, `width`/`height` for layout boxes, `color`, `backgroundColor`, `borderColor`, `fontSize`) goes through `$tokens`.

### 2. Compose layout via Tamagui props

Stacking, spacing, and surfaces compose entirely from props on `YStack` / `XStack`. Do not wrap with a `View` and a style sheet.

```tsx
// components/ui/Sheet.tsx
<TamaguiSheet.Frame padding="$4" gap="$3">
  {children}
</TamaguiSheet.Frame>
```

```tsx
// app/(tabs)/settings.tsx
<XStack gap="$3" alignItems="center">
  <Avatar circular size="$6">{/* ... */}</Avatar>
  <YStack>
    <Paragraph fontWeight="600">{user?.displayName ?? user?.name ?? 'Unknown'}</Paragraph>
    <Paragraph color="$gray10">{user?.email}</Paragraph>
  </YStack>
</XStack>
```

Shorthands (`bg`, `p`, `m`, `br`, `w`, `h`) are encouraged for brevity, but be consistent within a file.

### 3. Inline props vs `styled()`

- **Inline props** for one-off layouts inside a screen or a single-use component. The compiler still flattens them at build time.
- **`styled(...)`** for any visual treatment used in 2+ places, or anywhere variants are needed. Always give it a `name` so themes can target it and devtools can identify it.

```tsx
// components/ui/Button.tsx — wrapper around TamaguiButton that adds a `variant`
// + `loading` API. This is the canonical "styled" pattern for this codebase:
// a forwardRef component that merges a variant map into the Tamagui base.
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', loading, disabled, children, ...rest },
  ref,
) {
  const styles = variantStyles[variant];
  return (
    <TamaguiButton
      ref={ref as never}
      disabled={disabled || loading}
      opacity={disabled || loading ? 0.6 : 1}
      borderRadius="$4"
      fontWeight="600"
      icon={loading ? <Spinner /> : undefined}
      {...styles}
      {...rest}
    >
      {loading ? null : children}
    </TamaguiButton>
  );
});
```

When a true `styled(Stack, { ... })` is needed (no behavior, just reusable visuals), follow the form shown in `gen-guidelines/modules/typescript/tamagui-styling.module.md` and add `name: 'CardTitle'` etc.

### 4. Variants for state-driven styling

Encode boolean / enum visual state as a variant rather than a ternary on a style prop. The `Button` variant map above is the canonical example. For light reuse, prefer the map-of-partial-props approach; for heavily-reused primitives, use Tamagui's `variants:` block on `styled()`.

### 5. Platform-specific style props

Two acceptable approaches:

- **Tamagui platform pseudos** (`$platform-ios`, `$platform-android`) for small style deltas:

  ```tsx
  <YStack
    paddingTop="$3"
    $platform-ios={{ paddingTop: '$5' }}
    $platform-android={{ paddingTop: '$3' }}
  />
  ```

- **`Platform.OS` branch** when behavior differs (different children, different libraries):

  ```tsx
  // components/ui/BlurCard.tsx
  // expo-blur on Android is unreliable; fall back to a translucent solid surface.
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
  ```

The Android branch above is also the canonical example of using *Tamagui tokens only* even inside a `Platform.OS` split.

### 6. The one legitimate `StyleSheet` use

`StyleSheet.absoluteFill` is the only `StyleSheet` reference allowed — it is a constant, not a `StyleSheet.create` call, and is required to position non-Tamagui overlays like `expo-blur`:

```tsx
// components/ui/BlurCard.tsx
<BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
```

If you find yourself wanting `StyleSheet.create`, write a `styled()` or use inline Tamagui props instead.

## Anti-Patterns

- **`StyleSheet.create({ ... })`** anywhere in `app/` or `components/`. There are zero such calls today (the only `StyleSheet` reference is the `absoluteFill` constant at `components/ui/BlurCard.tsx:43`); keep it that way.
- **Raw hex / rgba** in component code. Use `$red10`, `$gray12`, `$background`, etc. `components/ui/Button.tsx:14` intentionally uses `'white'` as a special case for high-contrast button labels — do not generalize this; new code should reach for `$color` or a token.
- **`style={{ padding: 16, backgroundColor: '#fff' }}`** on Tamagui components — defeats the compiler and the theme. Use props: `padding="$4" backgroundColor="$background"`.
- **Per-screen `<Theme name="...">` wrappers** — the **single** `<Theme name={effectiveTheme}>` belongs at the root, directly under `TamaguiProvider`, and switches via the UI store (`useUIStore.theme` + `useColorScheme`). v2 requires this root wrapper for propagation; do not add extra per-screen `<Theme>` wrappers to "fix" theming.
- **Conditional style props with ternaries on heavily-reused components** — use a variant map (see `Button`) or a `variants:` block.

## Decision Rationale

See `../decisions.md` for the reasoning behind making Tamagui the single styling source (compiler-driven flattening, theme tokens for dark mode, removal of duplicate spacing scales, and why we standardize on `@tamagui/config/v5` defaults — plus the v5-reanimated animations driver and `onlyAllowShorthands: false` — instead of a custom token set).
