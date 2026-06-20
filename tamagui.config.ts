import { defaultConfig } from '@tamagui/config/v5';
// v2 unbundles animations from the config — wire the Reanimated driver so the
// animation presets (used via animation="lazy" in components/ui/Sheet) resolve
// on native.
import { animations } from '@tamagui/config/v5-reanimated';
import { createTamagui } from 'tamagui';

const config = createTamagui({
  ...defaultConfig,
  animations,
  settings: {
    ...defaultConfig.settings,
    // v2 rejects longhand style props (backgroundColor, alignItems, …) by
    // default; the components/screens here use longhands, so re-enable them.
    onlyAllowShorthands: false,
  },
});

export type AppConfig = typeof config;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
