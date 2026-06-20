/** @type {import('jest').Config} */

// Some RN/Expo packages resolve @babel/runtime helpers relative to their own
// dir, where bun's flat layout installs no copy; pin to wherever the real one
// lives so the mapping survives linker changes (hoisted vs isolated).
const babelRuntimeDir = require('node:path').dirname(
  require.resolve('@babel/runtime/package.json'),
);

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@sentry/react-native|tamagui|@tamagui/.*|posthog-react-native|@workos-inc/.*))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@babel/runtime/(.*)$': `${babelRuntimeDir}/$1`,
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/',
    '/ios/',
    '/android/',
    '/.expo/',
    '/dist/',
  ],
};
