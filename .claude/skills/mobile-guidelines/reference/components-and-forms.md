---
name: components-and-forms
description: UI composition and form patterns for this codebase. Half A covers the components/ui barrel, the icons re-export, and how to compose primitives. Half B covers React Hook Form + Zod + the FormField wrapper that pairs Controller with the Tamagui Input.
---

# Components and Forms

## Purpose

This codebase has two import boundaries that downstream code must respect:

1. **UI primitives** live in `components/ui/` and are imported from the `@/components/ui` barrel. They wrap Tamagui base components with project-specific defaults (variants, error display, platform fallbacks).
2. **Icons** are imported from `@/components/icons` — a thin re-export of the Lucide icons actually used in the app. Direct `lucide-react-native` imports are forbidden in feature code so the icon surface stays auditable and tree-shakable.

Forms additionally standardize on React Hook Form + Zod, with a `<FormField>` wrapper that binds RHF's `Controller` to the project's `Input` primitive (label + error + hint).

---

## Half A — Components

### Pattern: Barrel-exported UI primitives

```ts
// components/ui/index.ts
export { BlurCard } from './BlurCard';
export { Button } from './Button';
export { Input } from './Input';
export { Sheet } from './Sheet';
```

Add new primitives to this barrel as you create them. Feature code should import from `@/components/ui`, not from individual files:

```tsx
// good
import { Button, Sheet } from '@/components/ui';

// also acceptable for a single import in a hot path
import { Button } from '@/components/ui/Button';
```

### Pattern: Primitives wrap, never re-implement

Each primitive is a `forwardRef` or simple function component that takes its Tamagui base's props and layers project conventions on top:

```tsx
// components/ui/Input.tsx
export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, hint, id, ...rest },
  ref,
) {
  const hasError = Boolean(error);
  return (
    <YStack gap="$1.5">
      {label ? (
        <Label htmlFor={id} color={hasError ? '$red10' : '$gray12'}>
          {label}
        </Label>
      ) : null}
      <TamaguiInput
        ref={ref as never}
        id={id}
        borderColor={hasError ? '$red8' : '$gray7'}
        focusStyle={{ borderColor: hasError ? '$red9' : '$blue9' }}
        {...rest}
      />
      {hasError ? (
        <Paragraph size="$2" color="$red10">{error}</Paragraph>
      ) : hint ? (
        <Paragraph size="$2" color="$gray10">{hint}</Paragraph>
      ) : null}
    </YStack>
  );
});
```

Notice the contract: the wrapper owns layout + error/hint rendering; everything else is spread through to the Tamagui base. Mirror this when adding new primitives.

### Pattern: Icons re-export

```ts
// components/icons.ts
export {
  Bell, Camera, Check, ChevronLeft, ChevronRight, Eye, EyeOff,
  Home, Info, LogOut, Mail, Menu, Moon, Plus, Search, Settings, Sun, User, X,
} from 'lucide-react-native';
```

- Feature code imports icons as `import { Camera } from '@/components/icons'`.
- New icons get added to `components/icons.ts` before use. The file is the allow-list.
- Do not import directly from `lucide-react-native` outside of `components/icons.ts`.

### Pattern: Composition

Screens compose Tamagui layout primitives (`YStack`, `XStack`, `Separator`, `H1`, `Paragraph`) directly from `tamagui` and reach for the `components/ui` primitives for interactive elements:

```tsx
// app/(tabs)/settings.tsx
<YStack flex={1} padding="$4" gap="$5" backgroundColor="$background">
  <H1>Settings</H1>
  <Separator />
  <Button variant="secondary" onPress={() => setSheetOpen(true)}>About</Button>
  <Button variant="destructive" onPress={handleSignOut} loading={signingOut}>Sign out</Button>
</YStack>

<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
  <H3>About</H3>
  <Paragraph>Mobile Template — Expo Router + Tamagui + Convex.</Paragraph>
</Sheet>
```

---

## Half B — Forms

### Pattern: `useForm` + `zodResolver` + `z.infer`

Define the schema, derive the form type with `z.infer`, then wire `useForm` to `zodResolver`:

```tsx
// canonical shape for any form screen in this codebase
const signInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});
type SignInValues = z.infer<typeof signInSchema>;

const { control, handleSubmit } = useForm<SignInValues>({
  resolver: zodResolver(signInSchema),
  defaultValues: { email: '', password: '' },
});
```

Always derive the values type via `z.infer<typeof schema>`. Do not declare a parallel `interface SignInValues`.

### Pattern: `<FormField>` wraps `Controller` + `Input`

The `FormField` component is the only correct way to wire a form field in this codebase. It owns the `Controller` + value/blur/ref bridging, and forwards the field error to the `Input`'s `error` prop:

```tsx
// components/forms/FormField.tsx
export function FormField<T extends FieldValues>({
  name,
  control,
  label,
  hint,
  rules,
  inputProps,
}: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      rules={rules}
      render={({ field, fieldState }) => (
        <Input
          label={label}
          hint={hint}
          error={fieldState.error?.message}
          value={field.value ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          {...inputProps}
        />
      )}
    />
  );
}
```

Usage in a screen:

```tsx
<YStack gap="$3">
  <FormField name="email" control={control} label="Email"
    inputProps={{ keyboardType: 'email-address', autoCapitalize: 'none' }} />
  <FormField name="password" control={control} label="Password"
    inputProps={{ secureTextEntry: true }} />
  <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting}>Sign in</Button>
</YStack>
```

`app/(auth)/sign-in.tsx` is the canonical screen-level example; today it uses the SSO `signIn()` flow rather than a credentialed form, but any future credentialed sign-in or sign-up screen must follow the `useForm` + `FormField` shape above.

### Pattern: Reusable schemas live in `lib/schemas/`

When a Zod schema is shared across two or more screens (e.g. an `emailSchema` used in sign-in, sign-up, and a "change email" flow), place it under `lib/schemas/` and import it from each screen. This directory does not exist yet — create it on first need. One-off schemas can stay co-located with the screen.

## Anti-Patterns

- **Direct `lucide-react-native` imports outside `components/icons.ts`** — breaks the allow-list. There are zero such imports today (`components/icons.ts:21` is the only file allowed to touch the package); keep it that way.
- **Raw `Controller` in screens** — use `<FormField>` so error rendering stays consistent. If a field truly cannot be expressed via `Input`, build a sibling wrapper (`FormSelect`, `FormSwitch`) following the same `Controller` + primitive shape.
- **Parallel `interface FormValues` next to a Zod schema** — derive with `z.infer<typeof schema>` so the schema stays the single source of truth.
- **Re-exporting Tamagui components from `components/ui`** — that barrel is for project primitives that *wrap* Tamagui, not pass-throughs. Import `YStack`, `XStack`, `H1`, `Paragraph`, etc. directly from `tamagui`.
- **Adding a new primitive without updating `components/ui/index.ts`** — keeps the import path consistent across the codebase.

## Decision Rationale

See `../decisions.md` for why this codebase wraps Tamagui primitives rather than using them raw (consistent error UI, variant API for `Button`, Android fallback for `BlurCard`), why icons are funneled through a single re-export (bundle audit, tree-shaking, and preventing duplicate icon libraries from drifting in), and why React Hook Form + Zod + a `Controller`-based `FormField` is preferred over uncontrolled `register()` flows on React Native.
