---
name: auth-workos-pkce
description: End-to-end WorkOS PKCE auth lifecycle in this codebase — sign-in, callback, token exchange, refresh, sign-out, and the post-auth Convex bridge. Tokens live in SecureStore; the Zustand store holds only `user`.
---

# Auth: WorkOS PKCE

## Purpose

Sign-in goes through WorkOS AuthKit with OAuth 2.0 Authorization Code + PKCE. PKCE values (verifier, state) live in SecureStore during the round-trip; the access + refresh tokens that come back also live in SecureStore. The Zustand auth store holds only the deserialized `user` profile and an `isLoading` flag — never a token. Convex gets its bearer token through `useConvexAuthBridge`, which reads SecureStore on demand and refreshes when expired.

Two boundaries: a **storage boundary** (tokens are SecureStore-class, `user` is MMKV-persisted Zustand — see `storage-and-crypto.md`) and a **mount boundary** (the Convex bridge mounts inside `app/(tabs)/_layout.tsx`, after the auth gate, never in `app/_layout.tsx`).

## Patterns

### Sign-in: build authorize URL, stash PKCE, open WebBrowser

```ts
// lib/auth/index.ts
const PKCE_VERIFIER_KEY = 'mobile-template:pkce-verifier';
const PKCE_STATE_KEY = 'mobile-template:pkce-state';

export async function signIn(): Promise<SignInResult> {
  const { url, pkce, state } = await buildAuthorizeUrl();
  await secureSet(PKCE_VERIFIER_KEY, pkce.verifier);
  await secureSet(PKCE_STATE_KEY, state);
  const result = await WebBrowser.openAuthSessionAsync(url, workosConfig.redirectUri);
  // ... parse result.url, check returnedState === state, return code
}
```

```ts
// lib/auth/workos.ts
export async function buildAuthorizeUrl(input: AuthorizeUrlInput = {}) {
  const pkce = await generatePkcePair();
  const state = input.state ?? cryptoRandomState();
  // ... build URL with code_challenge, code_challenge_method=S256, state
}
```

PKCE pair generation uses `react-native-quick-crypto` (see `lib/auth/pkce.ts`). The `state` value must come from `QuickCrypto.randomBytes(16).toString('hex')` too — `cryptoRandomState()` currently violates this, see Anti-Patterns.

### Callback: parse, validate state, complete sign-in

```tsx
// app/auth/callback.tsx
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; state?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await completeSignIn({ code: params.code, state: params.state });
        if (!cancelled) router.replace('/(tabs)');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    })();
    return () => { cancelled = true; };
  }, [params.code, params.state]);
  // ... render spinner or error
}
```

The route lives outside the `(auth)` and `(tabs)` groups so neither layout's `<Redirect>` gate fires before the exchange completes.

### Token exchange: state CSRF check, verifier lookup, persist, cleanup

```ts
// lib/auth/index.ts
export async function completeSignIn({ code, state }: CompleteSignInInput) {
  const { setUser, setLoading } = useAuthStore.getState();
  setLoading(true);
  try {
    const expectedState = await secureGet(PKCE_STATE_KEY);
    if (!expectedState || expectedState !== state) {
      throw new Error('State mismatch when completing sign-in');
    }
    const verifier = await secureGet(PKCE_VERIFIER_KEY);
    if (!verifier) throw new Error('Missing PKCE verifier');

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
```

The state-mismatch check is the CSRF defence — an attacker who can reach the callback URL still can't produce a `state` matching the one we stashed in SecureStore before opening the session. **PKCE cleanup is mandatory** and should run in a `finally` so the keys are deleted on both success and failure (see Anti-Patterns). Tokens persist via `saveTokens` → `secureSet` → `SecureStore.setItemAsync`; the user goes to Zustand via `setUser`. Tokens never enter the store.

### Token shape & storage

```ts
// lib/auth/tokens.ts
const TOKENS_KEY = 'mobile-template:auth-tokens';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
};

export async function saveTokens(tokens: AuthTokens) {
  await secureSet(TOKENS_KEY, JSON.stringify(tokens));
}
```

`expiresAt` has 30 s skew already subtracted, so "expired?" is just `Date.now() >= expiresAt`.

### Refresh: silently rotate access tokens

```ts
// lib/auth/index.ts
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
  if (!response.ok) { await clearTokens(); return null; }
  // ... save next tokens, preserving refreshToken/idToken when omitted
}
```

A refresh failure clears tokens; the next time `user` becomes `null`, the `(tabs)` gate redirects to sign-in.

### Convex bridge — mounted post-auth, dedupes in-flight refreshes

```ts
// lib/convex/auth.ts
export function useConvexAuthBridge(): void {
  const user = useAuthStore((s) => s.user);
  const fetcher = useFetchConvexAccessToken();

  useEffect(() => {
    if (!user) {
      convexClient.clearAuth();
      return;
    }
    convexClient.setAuth(fetcher);
  }, [user, fetcher]);
}
```

The fetcher reads SecureStore on every call, refreshes when expired (or when Convex passes `forceRefreshToken: true`), and dedupes concurrent refreshes via an `inflight` ref — two queries firing at expiry would otherwise POST to `/authenticate` with the same refresh token and one would 400.

**Mount rule.** `useConvexAuthBridge()` MUST be called inside `app/(tabs)/_layout.tsx` (or any post-auth-gate layout) — alongside the `useAuthStore((s) => s.user)` read that drives the gate. Mounting it in `app/_layout.tsx` runs pre-auth, attaches a null-returning fetcher, and storms `/authenticate` while the user is still on `/sign-in`.

### Cold-start session restore

`useAuthBootstrap` (in `lib/auth/index.ts`) reads tokens from SecureStore, refreshes if expired, fetches the user, and calls `setUser`. Mount it once in `app/_layout.tsx` — it only reads SecureStore and writes `user` to Zustand, so pre-auth is fine. The `(auth)` and `(tabs)` `<Redirect>` gates fire after bootstrap resolves, so cold start lands the user on the right side.

### Sign-out: clear, then best-effort remote logout

```ts
// lib/auth/index.ts
export async function signOut(): Promise<void> {
  const tokens = await getTokens();
  await clearTokens();
  useAuthStore.getState().clear();
  if (tokens?.idToken) {
    try { await fetch(`${workosConfig.logoutEndpoint}?id_token_hint=...`); }
    catch { /* Best-effort remote logout. */ }
  }
}
```

Local clear runs first and unconditionally — the user is signed out the moment the function returns, even if the remote logout fails. Per the locked decision this also calls `posthog.reset()` and `Sentry.setUser(null)` to detach analytics and crash-report identity; wire those in alongside the store clear.

### Auth gates — `<Redirect>` in both group layouts

```tsx
// app/(auth)/_layout.tsx — kicks authed users out of /sign-in
const user = useAuthStore((s) => s.user);
if (user) return <Redirect href="/(tabs)" />;
```

```tsx
// app/(tabs)/_layout.tsx — kicks unauthed users back to /sign-in
const user = useAuthStore((s) => s.user);
if (!user) return <Redirect href="/(auth)/sign-in" />;
```

Both gates read the same `user` selector — one field, one source of truth.

## Anti-Patterns

- `lib/auth/workos.ts:49-53` — `cryptoRandomState()` uses `Math.random().toString(36) + Date.now().toString(36)` to build the OAuth `state`. `Math.random()` is a non-cryptographic PRNG; combined with a millisecond timestamp it's predictable enough to forge a callback that passes the state check. Replace with `QuickCrypto.randomBytes(16).toString('hex')`.
- `lib/auth/index.ts:76-77` — PKCE keys are deleted only on the success path; an exception in `exchangeCodeForTokens` or `fetchWorkosUser` leaves `pkce_verifier` and `pkce_state` lingering in SecureStore. Move the two `secureDelete` calls into a `finally` so they always run.
- Mounting `useConvexAuthBridge` in `app/_layout.tsx`. It would attach a null fetcher pre-auth and storm `/authenticate` while the user is still on `/sign-in`. The bridge belongs in `app/(tabs)/_layout.tsx`.
- Putting `accessToken` or `refreshToken` into Zustand (even with `partialize`). They'd land in MMKV cleartext. See `state-zustand.md` and `storage-and-crypto.md`.
- Skipping the state-mismatch check on the callback. Without it the route accepts arbitrary `code` values from any caller that can reach the redirect URI.
- Re-fetching `getTokens()` per render instead of going through `useConvexAuthBridge`. The bridge dedupes in-flight refreshes and centralizes the expiry policy — calling sites that bypass it can cause concurrent refresh-token POSTs that invalidate each other.

## Decision Rationale

See `../decisions.md` for why tokens live in SecureStore while `user` lives in Zustand, why `useConvexAuthBridge` mounts in `(tabs)/_layout.tsx` (not `app/_layout.tsx`), and why `react-native-quick-crypto` — not `Math.random()`, not `expo-crypto` — is the source of `state` and `code_verifier` bytes.
