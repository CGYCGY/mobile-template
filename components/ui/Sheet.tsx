import type { ReactNode } from 'react';
import { type SheetProps, Sheet as TamaguiSheet } from 'tamagui';

type Props = Omit<SheetProps, 'children'> & {
  children: ReactNode;
  snapPoints?: number[];
};

export function Sheet({
  children,
  snapPoints = [80, 50],
  dismissOnSnapToBottom = true,
  // Tamagui v2 renamed the `animation` prop to `transition`.
  transition = 'medium',
  modal = true,
  ...rest
}: Props) {
  return (
    <TamaguiSheet
      snapPoints={snapPoints}
      dismissOnSnapToBottom={dismissOnSnapToBottom}
      transition={transition}
      modal={modal}
      {...rest}
    >
      <TamaguiSheet.Overlay
        transition="lazy"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <TamaguiSheet.Handle />
      <TamaguiSheet.Frame padding="$4" gap="$3">
        {children}
      </TamaguiSheet.Frame>
    </TamaguiSheet>
  );
}
