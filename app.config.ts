import type { ExpoConfig } from 'expo/config';
import './env';

type Variant = 'dev' | 'preview' | 'production';

const variant = (process.env.APP_VARIANT ?? 'production') as Variant;

const bundleSuffix: Record<Variant, string> = {
  dev: '.dev',
  preview: '.preview',
  production: '',
};

const baseId = 'com.example.mobiletemplate';
const bundleIdentifier = `${baseId}${bundleSuffix[variant]}`;

const config: ExpoConfig = {
  name: 'Mobile Template',
  slug: 'mobile-template',
  scheme: 'mobiletemplate',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    package: bundleIdentifier,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-camera',
    'expo-image-picker',
    'expo-notifications',
    'expo-font',
    'expo-splash-screen',
    [
      'expo-build-properties',
      {
        ios: { useFrameworks: 'static' },
        android: {},
      },
    ],
    '@sentry/react-native/expo',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: 'TODO-set-from-eas-init',
    },
  },
  updates: {
    url: 'https://u.expo.dev/TODO-project-id',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
};

export default config;
