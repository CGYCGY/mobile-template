import * as SecureStore from 'expo-secure-store';

type SecureOptions = {
  keychainAccessible?: SecureStore.KeychainAccessibilityConstant;
  requireAuthentication?: boolean;
};

const DEFAULT_OPTIONS: SecureOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function secureSet(
  key: string,
  value: string,
  opts?: SecureOptions,
): Promise<void> {
  await SecureStore.setItemAsync(key, value, { ...DEFAULT_OPTIONS, ...opts });
}

export async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
