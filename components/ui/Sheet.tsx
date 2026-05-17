import type { ReactNode } from 'react';
import { Sheet as TamaguiSheet, type SheetProps } from 'tamagui';

type Props = Omit<SheetProps, 'children'> & {
  children: ReactNode;
  snapPoints?: number[];
};

export function Sheet({
  children,
  snapPoints = [80, 50],
  dismissOnSnapToBottom = true,
  animation = 'medium',
  modal = true,
  ...rest
}: Props) {
  return (
    <TamaguiSheet
      snapPoints={snapPoints}
      dismissOnSnapToBottom={dismissOnSnapToBottom}
      animation={animation}
      modal={modal}
      {...rest}
    >
      <TamaguiSheet.Overlay
        animation="lazy"
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
