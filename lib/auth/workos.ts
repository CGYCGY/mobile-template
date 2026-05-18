import QuickCrypto from 'react-native-quick-crypto';
import { env } from '@/env';
import { generatePkcePair, type PkcePair } from './pkce';

const WORKOS_BASE_URL = 'https://api.workos.com';

export const workosConfig = {
  clientId: env.EXPO_PUBLIC_WORKOS_CLIENT_ID,
  redirectUri: env.EXPO_PUBLIC_WORKOS_REDIRECT_URI,
  baseUrl: WORKOS_BASE_URL,
  authorizeEndpoint: `${WORKOS_BASE_URL}/user_management/authorize`,
  tokenEndpoint: `${WORKOS_BASE_URL}/user_management/authenticate`,
  logoutEndpoint: `${WORKOS_BASE_URL}/user_management/sessions/logout`,
} as const;

export type AuthorizeUrlInput = {
  state?: string;
  provider?: string;
};

export type AuthorizeUrl = {
  url: string;
  pkce: PkcePair;
  state: string;
};

export async function buildAuthorizeUrl(
  input: AuthorizeUrlInput = {},
): Promise<AuthorizeUrl> {
  const pkce = await generatePkcePair();
  const state = input.state ?? cryptoRandomState();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: workosConfig.clientId,
    redirect_uri: workosConfig.redirectUri,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    provider: input.provider ?? 'authkit',
  });

  return {
    url: `${workosConfig.authorizeEndpoint}?${params.toString()}`,
    pkce,
    state,
  };
}

function cryptoRandomState(): string {
  return Buffer.from(QuickCrypto.randomBytes(16))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
