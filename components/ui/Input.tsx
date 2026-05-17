import { forwardRef } from 'react';
import type { TextInput } from 'react-native';
import {
  Input as TamaguiInput,
  type InputProps,
  Label,
  Paragraph,
  YStack,
} from 'tamagui';

type Props = InputProps & {
  label?: string;
  error?: string;
  hint?: string;
};

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
        focusStyle={{
          borderColor: hasError ? '$red9' : '$blue9',
        }}
        {...rest}
      />
      {hasError ? (
        <Paragraph size="$2" color="$red10">
          {error}
        </Paragraph>
      ) : hint ? (
        <Paragraph size="$2" color="$gray10">
          {hint}
        </Paragraph>
      ) : null}
    </YStack>
  );
});
