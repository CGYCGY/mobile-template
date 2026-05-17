import { defaultConfig } from '@tamagui/config/v4';
import { createTamagui } from 'tamagui';

const config = createTamagui(defaultConfig);

export type AppConfig = typeof config;

declare module 'tamagui' {
  // biome-ignore lint/suspicious/noEmptyInterface: required by Tamagui module augmentation
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
