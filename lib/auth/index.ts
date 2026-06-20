import { Buffer } from 'buffer';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { secureDelete, secureGet, secureSet } from '@/lib/storage';
import { type User, useAuthStore } from '@/stores/auth';
import {
  type AuthTokens,
  clearTokens,
  getTokens,
  saveTokens,
  type WorkosUserPayload,
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

    const user = await userFromTokens(tokens);
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

// Single-flight: bootstrap and the Convex auth bridge can both ask for a refresh
// at once; without this they race two POSTs and one clobbers the other's tokens.
let refreshInflight: Promise<AuthTokens | null> | null = null;

export function refreshAccessToken(): Promise<AuthTokens | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = doRefresh().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

async function doRefresh(): Promise<AuthTokens | null> {
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
    // Only wipe tokens on a definitive "session revoked" response. 429/5xx or
    // network errors are transient — throwing lets callers retry without
    // destroying a still-valid refresh token (e.g. offline / flaky network).
    if (response.status === 400 || response.status === 401) {
      let payload: { error?: string } = {};
      try {
        payload = (await response.json()) as { error?: string };
      } catch {
        // ignore parse failure — treat as non-definitive
      }
      if (payload.error === 'invalid_grant') {
        await clearTokens();
        return null;
      }
    }
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const json = (await response.json()) as WorkosTokenResponse;
  const next: AuthTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    idToken: json.id_token ?? tokens.idToken,
    expiresAt: computeExpiresAt(json.expires_in),
    user: json.user ?? tokens.user,
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
          const staleTokens = tokens;
          let refreshed: AuthTokens | null = null;
          try {
            refreshed = await refreshAccessToken();
          } catch {
            // Transient error (network/5xx/429): reuse the stale stored user so
            // the app stays usable offline; the next API call re-triggers refresh.
            const user = await userFromTokens(staleTokens);
            if (!cancelled) setUser(user);
            return;
          }
          if (!refreshed) {
            // refreshAccessToken returns null only on invalid_grant — session revoked.
            if (!cancelled) setUser(null);
            return;
          }
          tokens = refreshed;
        }

        const user = await userFromTokens(tokens);
        if (!cancelled) setUser(user);
      } catch {
        // Unexpected error (e.g. corrupt stored tokens); treat as no session.
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
  expires_in?: number;
  user?: WorkosUserPayload;
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
  // Embed the user payload from the exchange response so sign-in doesn't need a
  // second round-trip to resolve the current user.
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    idToken: json.id_token,
    expiresAt: computeExpiresAt(json.expires_in),
    user: json.user,
  };
}

type IdTokenClaims = {
  sub: string;
  email: string;
  first_name?: string;
  last_name?: string;
  picture?: string;
};

function decodeIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid id_token format');
  const payload = parts[1];
  if (!payload) throw new Error('Invalid id_token format');
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(base64, 'base64').toString('utf8');
  return JSON.parse(json) as IdTokenClaims;
}

function userFromWorkosPayload(payload: WorkosUserPayload): User {
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

// Resolve the current user without a network call when possible: prefer the
// embedded payload, then the self-contained id_token claims, and only fall back
// to a /users/me fetch when neither is present.
async function userFromTokens(tokens: AuthTokens): Promise<User> {
  if (tokens.user) {
    return userFromWorkosPayload(tokens.user);
  }
  if (tokens.idToken) {
    const claims = decodeIdToken(tokens.idToken);
    const name = [claims.first_name, claims.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      id: claims.sub,
      email: claims.email,
      name: name || claims.email,
      displayName: name || undefined,
      avatarUrl: claims.picture ?? undefined,
    };
  }
  return fetchWorkosUser(tokens.accessToken);
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
  return userFromWorkosPayload(payload);
}

function computeExpiresAt(expiresInSeconds: number | undefined): number {
  const seconds = expiresInSeconds ?? 3600;
  const skewMs = 30_000;
  return Date.now() + seconds * 1000 - skewMs;
}

function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

function parseCallbackUrl(url: string): URLSearchParams {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(url.slice(queryIndex + 1));
}

export type { AuthTokens };
export { clearTokens, getTokens, saveTokens };
