import {
  type Control,
  Controller,
  type FieldPath,
  type FieldValues,
  type RegisterOptions,
} from 'react-hook-form';
import type { InputProps } from 'tamagui';
import { Input } from '@/components/ui/Input';

type Props<T extends FieldValues> = {
  name: FieldPath<T>;
  control: Control<T>;
  label?: string;
  hint?: string;
  rules?: Omit<
    RegisterOptions<T, FieldPath<T>>,
    'valueAsNumber' | 'valueAsDate' | 'setValueAs' | 'disabled'
  >;
  inputProps?: Omit<InputProps, 'value' | 'onChangeText' | 'onBlur'>;
};

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
