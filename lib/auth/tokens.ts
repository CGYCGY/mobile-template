import { secureDelete, secureGet, secureSet } from '@/lib/storage';

const TOKENS_KEY = 'mobile-template:auth-tokens';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
};

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await secureSet(TOKENS_KEY, JSON.stringify(tokens));
}

export async function getTokens(): Promise<AuthTokens | null> {
  const raw = await secureGet(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await secureDelete(TOKENS_KEY);
}
