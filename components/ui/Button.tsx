import { forwardRef } from 'react';
import { Button as TamaguiButton, type ButtonProps, Spinner } from 'tamagui';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

type Props = Omit<ButtonProps, 'variant'> & {
  variant?: Variant;
  loading?: boolean;
};

const variantStyles: Record<Variant, Partial<ButtonProps>> = {
  primary: {
    backgroundColor: '$blue10',
    color: 'white',
    pressStyle: { backgroundColor: '$blue11' },
    hoverStyle: { backgroundColor: '$blue11' },
  },
  secondary: {
    backgroundColor: '$gray5',
    color: '$gray12',
    pressStyle: { backgroundColor: '$gray6' },
    hoverStyle: { backgroundColor: '$gray6' },
  },
  ghost: {
    backgroundColor: 'transparent',
    color: '$gray12',
    pressStyle: { backgroundColor: '$gray4' },
    hoverStyle: { backgroundColor: '$gray4' },
  },
  destructive: {
    backgroundColor: '$red10',
    color: 'white',
    pressStyle: { backgroundColor: '$red11' },
    hoverStyle: { backgroundColor: '$red11' },
  },
};

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
