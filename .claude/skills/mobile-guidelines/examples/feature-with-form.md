---
name: example-feature-with-form
description: Canonical RHF + Zod + FormField pattern. The FormField primitive is present in this codebase; downstream projects use it for any user-input form.
---

# Example: Feature With a Form

The `<FormField>` primitive (`components/forms/FormField.tsx`) wraps `Controller` + `<Input>` with consistent error display. Combined with `react-hook-form` and Zod, it's the only way to build forms in this codebase.

> Note: the current codebase does not yet ship a screen that uses `FormField` — the primitive is present and ready. The pattern below is the canonical usage for downstream projects.

## The primitive

```tsx
// components/forms/FormField.tsx
import {
  type Control, Controller, type FieldPath, type FieldValues, type RegisterOptions,
} from 'react-hook-form';
import type { InputProps } from 'tamagui';
import { Input } from '@/components/ui/Input';

type Props<T extends FieldValues> = {
  name: FieldPath<T>;
  control: Control<T>;
  label?: string;
  hint?: string;
  rules?: Omit<RegisterOptions<T, FieldPath<T>>, 'valueAsNumber' | 'valueAsDate' | 'setValueAs' | 'disabled'>;
  inputProps?: Omit<InputProps, 'value' | 'onChangeText' | 'onBlur'>;
};

export function FormField<T extends FieldValues>({ name, control, label, hint, rules, inputProps }: Props<T>) {
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

## Canonical form usage

```tsx
// app/(tabs)/onboarding.tsx — example onboarding form
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from 'convex/react';
import { useForm } from 'react-hook-form';
import { Button, YStack } from 'tamagui';
import { z } from 'zod';
import { FormField } from '@/components/forms/FormField';
import { api } from '@/convex/_generated/api';

const schema = z.object({
  displayName: z.string().min(2, 'At least 2 characters').max(40),
  bio: z.string().max(280).optional(),
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingScreen() {
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const { control, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', bio: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    await completeOnboarding(values);
  });

  return (
    <YStack padding="$4" gap="$4">
      <FormField
        control={control}
        name="displayName"
        label="Display name"
        hint="Visible on your profile"
        inputProps={{ autoCapitalize: 'words', autoComplete: 'name' }}
      />
      <FormField
        control={control}
        name="bio"
        label="Bio"
        inputProps={{ multiline: true, numberOfLines: 4 }}
      />
      <Button onPress={onSubmit} loading={isSubmitting}>
        Save
      </Button>
    </YStack>
  );
}
```

## Patterns demonstrated

- ✓ **Schema-first** — Zod schema is declared once, then `z.infer<typeof schema>` produces the `FormValues` type. No duplicated interface.
- ✓ **`zodResolver`** wires Zod errors into RHF's `fieldState.error.message` — `FormField` shows them automatically.
- ✓ **`isSubmitting` on the submit button** for a free loading state — no separate `useState`.
- ✓ **`inputProps` passthrough** for Tamagui-native props like `autoCapitalize`, `multiline`, `secureTextEntry` (passwords), `keyboardType`.
- ✓ **Convex mutation integration** — `handleSubmit` awaits the mutation; failures throw and RHF surfaces them via `formState.errors.root` if you opt in.

## Schema location

For schemas reused across screens (e.g., a `User` schema shared between onboarding and profile-edit), put them in `lib/schemas/<feature>.ts` and import. Co-locate single-use schemas with the screen.

## Anti-patterns

- ❌ Building a form without `FormField` (raw `<Input>` + `useState`). You lose the error wiring and create N validation paths.
- ❌ Declaring a TypeScript `interface` AND a Zod schema. Declare the schema; derive the type with `z.infer`.
- ❌ `register('name')` instead of `Controller`/`FormField`. RHF's uncontrolled `register` doesn't work cleanly with RN inputs.
- ❌ Calling `setValue` from `useEffect` to sync external state. Use `defaultValues` or `reset()`.
