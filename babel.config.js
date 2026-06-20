module.exports = (api) => {
  api.cache(true);

  // Plugin ordering is load-bearing:
  // 1. "@tamagui/babel-plugin" must run before Reanimated so it can extract
  //    style props from Tamagui components without Reanimated rewriting them.
  // 2. "react-native-reanimated/plugin" MUST be the last entry — it relies on
  //    seeing the final AST and breaks silently if another plugin runs after it.
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: './tamagui.config.ts',
          logTimings: true,
          // Extract only for production builds. Under jest (NODE_ENV=test) the v2
          // extractor's injected runtime hits uninitialized state and throws, so
          // keep it off everywhere but production.
          disableExtraction: process.env.NODE_ENV !== 'production',
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
