import { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore, type User } from '@/stores/auth';
import { secureDelete, secureGet, secureSet } from '@/lib/storage';
import {
  clearTokens,
  getTokens,
  saveTokens,
  type AuthTokens,
} from './tokens';
import { buildAuthorizeUrl, workosConfig } from './workos';

const PKCE_VERIFIER_KEY = 'mobile-template:pkce-verifier';
const PKCE_STATE_KEY = 'mobile-template:pkce-state';

export type SignInResult =
  | { type: 'success'; code: string; state: string }
  | { type: 'cancel' }
  | { type: 'dismiss' }
  | { type: 'error'; message: string };

export async function signIn(): Promise<SignInResult> {
  const { url, pkce, state } = await buildAuthorizeUrl();
  await secureSet(PKCE_VERIFIER_KEY, pkce.verifier);
  await secureSet(PKCE_STATE_KEY, state);

  const result = await WebBrowser.openAuthSessionAsync(
    url,
    workosConfig.redirectUri,
  );

  if (result.type !== 'success' || !result.url) {
    if (result.type === 'cancel') return { type: 'cancel' };
    if (result.type === 'dismiss') return { type: 'dismiss' };
    return { type: 'error', message: `Auth session ${result.type}` };
  }

  const params = parseCallbackUrl(result.url);
  const code = params.get('code');
  const returnedState = params.get('state');

  if (!code) {
    return { type: 'error', message: 'Missing code in callback' };
  }
  if (returnedState !== state) {
    return { type: 'error', message: 'State mismatch' };
  }

  return { type: 'success', code, state: returnedState };
}

export type CompleteSignInInput = {
  code: string;
  state: string;
};

export async function completeSignIn({
  code,
  state,
}: CompleteSignInInput): Promise<void> {
  const { setUser, setLoading } = useAuthStore.getState();
  setLoading(true);

  try {
    const expectedState = await secureGet(PKCE_STATE_KEY);
    if (!expectedState || expectedState !== state) {
      throw new Error('State mismatch when completing sign-in');
    }
    const verifier = await secureGet(PKCE_VERIFIER_KEY);
    if (!verifier) {
      throw new Error('Missing PKCE verifier');
    }

    const tokens = await exchangeCodeForTokens({ code, verifier });
    await saveTokens(tokens);
    await secureDelete(PKCE_VERIFIER_KEY);
    await secureDelete(PKCE_STATE_KEY);

    const user = await fetchWorkosUser(tokens.accessToken);
    setUser(user);
  } finally {
    setLoading(false);
  }
}

export async function signOut(): Promise<void> {
  const tokens = await getTokens();
  await clearTokens();
  useAuthStore.getState().clear();

  if (tokens?.idToken) {
    try {
      await fetch(
        `${workosConfig.logoutEndpoint}?id_token_hint=${encodeURIComponent(tokens.idToken)}`,
        { method: 'GET' },
      );
    } catch {
      // Best-effort remote logout.
    }
  }
}

export async function refreshAccessToken(): Promise<AuthTokens | null> {
  const tokens = await getTokens();
  if (!tokens?.refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: workosConfig.clientId,
    refresh_token: tokens.refreshToken,
  });

  const response = await fetch(workosConfig.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    await clearTokens();
    return null;
  }

  const json = (await response.json()) as WorkosTokenResponse;
  const next: AuthTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    idToken: json.id_token ?? tokens.idToken,
    expiresAt: computeExpiresAt(json.expires_in),
  };
  await saveTokens(next);
  return next;
}

export function useAuthBootstrap(): void {
  const setUser = useAuthStore((s) => s.setUser);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        let tokens = await getTokens();
        if (!tokens) {
          if (!cancelled) setUser(null);
          return;
        }

        if (isExpired(tokens.expiresAt)) {
          tokens = await refreshAccessToken();
          if (!tokens) {
            if (!cancelled) setUser(null);
            return;
          }
        }

        const user = await fetchWorkosUser(tokens.accessToken);
        if (!cancelled) setUser(user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setUser, setLoading]);
}

type WorkosTokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  user?: WorkosUserPayload;
};

type WorkosUserPayload = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_picture_url?: string | null;
};

async function exchangeCodeForTokens(input: {
  code: string;
  verifier: string;
}): Promise<AuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: workosConfig.clientId,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: workosConfig.redirectUri,
  });

  const response = await fetch(workosConfig.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as WorkosTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    idToken: json.id_token,
    expiresAt: computeExpiresAt(json.expires_in),
  };
}

async function fetchWorkosUser(accessToken: string): Promise<User> {
  const response = await fetch(
    `${workosConfig.baseUrl}/user_management/users/me`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to load user: ${response.status}`);
  }
  const payload = (await response.json()) as WorkosUserPayload;
  const name = [payload.first_name, payload.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return {
    id: payload.id,
    email: payload.email,
    name: name || payload.email,
    displayName: name || undefined,
    avatarUrl: payload.profile_picture_url ?? undefined,
  };
}

function computeExpiresAt(expiresInSeconds: number): number {
  const skewMs = 30_000;
  return Date.now() + expiresInSeconds * 1000 - skewMs;
}

function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

function parseCallbackUrl(url: string): URLSearchParams {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(url.slice(queryIndex + 1));
}

export { getTokens, clearTokens, saveTokens };
export type { AuthTokens };
