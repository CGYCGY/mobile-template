const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

const baseConfig = getSentryExpoConfig
  ? getSentryExpoConfig(projectRoot)
  : getDefaultConfig(projectRoot);

baseConfig.transformer = {
  ...baseConfig.transformer,
  unstable_allowRequireContext: true,
};

module.exports = baseConfig;
