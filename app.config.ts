import type { ExpoConfig } from 'expo/config';
import './env.ts';

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
    [
      // SDK 56 dropped the top-level `splash` config key; splash is configured
      // through the plugin now.
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    [
      'expo-build-properties',
      {
        ios: { useFrameworks: 'static' },
        android: {},
      },
    ],
    [
      '@sentry/react-native/expo',
      {
        url: 'https://sentry.io/',
        organization: process.env.SENTRY_ORG ?? 'your-sentry-org',
        project: process.env.SENTRY_PROJECT ?? 'mobile-template',
        // The default bundle-task hook can't parse Expo's `export:embed` flavored
        // task and skips sourcemap upload; the AGP integration uploads Hermes
        // sourcemaps reliably instead.
        experimental_android: { enableAndroidGradlePlugin: true },
      },
    ],
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
