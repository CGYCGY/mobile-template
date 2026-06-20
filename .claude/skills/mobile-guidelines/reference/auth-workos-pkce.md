---
name: auth-workos-pkce
description: End-to-end WorkOS PKCE auth lifecycle in this codebase — sign-in, callback, token exchange, single-flight refresh, sign-out, and the root-mounted ConvexProviderWithAuth. Tokens live in SecureStore (split keys); the Zustand store holds only `user`.
---

# Auth: WorkOS PKCE

## Purpose

Sign-in goes through WorkOS AuthKit with OAuth 2.0 Authorization Code + PKCE. PKCE values (verifier, state) live in SecureStore during the round-trip; the access + refresh + id tokens that come back also live in SecureStore. The Zustand auth store holds only the deserialized `user` profile and an `isLoading` flag — never a token. Convex gets its bearer token through `ConvexProviderWithAuth`, which is mounted at the root and driven by the `useAuth()` hook (`lib/convex/use-auth.ts`); Convex calls `fetchAccessToken` only when `isAuthenticated` is true.

Two boundaries: a **storage boundary** (tokens are SecureStore-class — split across keys, see below — while `user` is MMKV-persisted Zustand; see `storage-and-crypto.md`) and a **token-fetch boundary** (Convex's token fetch is centralized in the module-scoped `fetchConvexAccessToken()` in `lib/convex/auth.ts`, and the underlying refresh is single-flighted in `lib/auth/index.ts`).

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

PKCE pair generation uses `react-native-quick-crypto` (see `lib/auth/pkce.ts`: `randomBytes(48)` for the verifier, `createHash('sha256')` for the challenge). The OAuth `state` comes from the same primitive — `cryptoRandomState()` is `QuickCrypto.randomBytes(16)` base64url-encoded, never `Math.random()`.

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

    const user = await userFromTokens(tokens);
    setUser(user);
  } finally {
    setLoading(false);
  }
}
```

The state-mismatch check is the CSRF defence — an attacker who can reach the callback URL still can't produce a `state` matching the one we stashed in SecureStore before opening the session. **PKCE cleanup is mandatory** and should run in a `finally` so the keys are deleted on both success and failure (see Anti-Patterns). Tokens persist via `saveTokens` → split `secureSet` writes; the user goes to Zustand via `setUser`. Tokens never enter the store.

`userFromTokens` resolves the profile **without** a network call when possible: the token-exchange response embeds a `user` payload, so it is preferred, then the self-contained `id_token` claims, and only as a last resort a `/user_management/users/me` fetch.

### Token shape & split storage

```ts
// lib/auth/tokens.ts
const PREFIX = 'mobile-template:auth';
const KEYS = {
  accessToken: `${PREFIX}-access-token`,
  refreshToken: `${PREFIX}-refresh-token`,
  idToken: `${PREFIX}-id-token`,
  meta: `${PREFIX}-meta`, // expiresAt + small embedded user payload
} as const;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  user?: WorkosUserPayload;
};

export async function saveTokens(tokens: AuthTokens) {
  const meta = { expiresAt: tokens.expiresAt, user: tokens.user };
  await Promise.all([
    secureSet(KEYS.accessToken, tokens.accessToken),
    secureSet(KEYS.refreshToken, tokens.refreshToken),
    tokens.idToken
      ? secureSet(KEYS.idToken, tokens.idToken)
      : secureDelete(KEYS.idToken),
    secureSet(KEYS.meta, JSON.stringify(meta)),
  ]);
}
```

**Why split keys, not one JSON blob.** Two JWTs plus the user payload routinely exceed `expo-secure-store`'s ~2048-byte per-item limit, and a write over that limit can fail **silently** — leaving a half-written or stale entry. Splitting access / refresh / id / meta into separate keys keeps every item well under the limit. `expiresAt` has 30 s skew already subtracted, so "expired?" is just `Date.now() >= expiresAt`.

### Refresh: single-flight, transient-safe

```ts
// lib/auth/index.ts
// Single-flight: bootstrap and the Convex token fetch can both ask for a refresh
// at once; without this they race two POSTs and one clobbers the other's tokens.
let refreshInflight: Promise<AuthTokens | null> | null = null;

export function refreshAccessToken(): Promise<AuthTokens | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = doRefresh().finally(() => { refreshInflight = null; });
  return refreshInflight;
}

async function doRefresh(): Promise<AuthTokens | null> {
  const tokens = await getTokens();
  if (!tokens?.refreshToken) return null;
  const response = await fetch(workosConfig.tokenEndpoint, { /* refresh_token grant */ });

  if (!response.ok) {
    // Only wipe tokens on a definitive "session revoked" reply. A 400/401 whose
    // body is `error: "invalid_grant"` means the refresh token is dead → clear.
    // 429 / 5xx / network errors are transient — THROW so the caller can retry
    // without destroying a still-valid refresh token (e.g. offline / flaky net).
    if (response.status === 400 || response.status === 401) {
      const payload = await response.json().catch(() => ({}));
      if (payload.error === 'invalid_grant') { await clearTokens(); return null; }
    }
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  // ... save next tokens, preserving refreshToken/idToken/user when omitted
}
```

The contract is precise: `refreshAccessToken()` returns `null` **only** on `invalid_grant` (session genuinely revoked → tokens cleared → the next `null` user redirects to sign-in). On any transient failure it **throws**, so callers keep the existing tokens and retry later. This is what lets the app survive offline.

### Convex token fetch — root-mounted provider, dual-flighted fetch

`ConvexProviderWithAuth` is mounted at the **root** in `app/_layout.tsx`, driven by `useAuth()`:

```ts
// lib/convex/use-auth.ts — shape matches ConvexProviderWithAuth's `useAuth` contract
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      fetchConvexAccessToken({ forceRefreshToken }),
    [],
  );
  return { isLoading, isAuthenticated: !!user, fetchAccessToken };
}
```

```ts
// lib/convex/auth.ts — module-scoped, dual-flighted by mode
let inflightForced: Promise<string | null> | null = null;
let inflightRead: Promise<string | null> | null = null;

export async function fetchConvexAccessToken({ forceRefreshToken }): Promise<string | null> {
  if (forceRefreshToken) {
    if (inflightForced) return inflightForced;
    // forced path always goes through refreshAccessToken()
  }
  if (inflightRead) return inflightRead;
  // read path: getTokens(), refresh only if past expiresAt
}
```

**Why root-mounting is safe (this is a flip from the old guidance).** Convex calls `fetchAccessToken` only when `useAuth()` reports `isAuthenticated: true`. Pre-auth `user` is `null`, so Convex never invokes the fetcher and the old "null fetcher storms `/authenticate`" failure mode no longer exists — there is nothing to gate behind a post-auth layout. The previous `useConvexAuthBridge()` hook is **gone**; do not reintroduce a per-layout bridge.

**Why dual-flight (separate forced vs read in-flight).** A `forceRefreshToken: true` call must NOT reuse a non-forced in-flight read, or a forced refresh would hand back the same expired token Convex just rejected. The underlying `refreshAccessToken` is itself single-flighted, so concurrent forced callers still share one network refresh.

### Cold-start session restore

`useAuthBootstrap` (in `lib/auth/index.ts`) is called once in `app/_layout.tsx` — it reads tokens from SecureStore, refreshes if expired, resolves the user via `userFromTokens`, and calls `setUser`. On a **transient** refresh failure it reuses the stale stored user so the app stays usable offline (the next token fetch re-triggers refresh); it sets `user` to `null` only when there are no tokens or the refresh returns `null` (`invalid_grant`). The `(auth)` and `(tabs)` `<Redirect>` gates fire after bootstrap resolves, so cold start lands the user on the right side.

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

- Building the OAuth `state` (or PKCE verifier) from `Math.random()` / `Date.now()`. `cryptoRandomState()` correctly uses `QuickCrypto.randomBytes(16)` today; a non-cryptographic PRNG would be predictable enough to forge a callback that passes the state check. Keep it on `randomBytes`.
- Deleting the PKCE keys only on the success path. They are removed after `saveTokens` in `completeSignIn`; an exception before that point still leaves `pkce-verifier`/`pkce-state` in SecureStore until the next sign-in overwrites them — prefer a `finally` if you refactor that function.
- Reintroducing a per-layout `useConvexAuthBridge()` (or any `convexClient.setAuth` call from a screen/layout). Token fetch is owned by the root `ConvexProviderWithAuth` + `useAuth()`; a second mount point double-drives the client.
- Writing all tokens into a single SecureStore key. The combined JWTs + user payload exceed the ~2048-byte per-item limit and the write can fail silently. Use the split keys in `lib/auth/tokens.ts`.
- Clearing tokens on any non-OK refresh response. Only `invalid_grant` (400/401 with that body) means the session is revoked; 429 / 5xx / network errors are transient and must preserve the refresh token (throw, don't clear) so the app survives offline.
- Calling `refreshAccessToken()` from multiple sites without relying on its single-flight. It is already single-flighted; bypassing it (e.g. a raw refresh POST) races two POSTs that invalidate each other's refresh token.
- Putting `accessToken` or `refreshToken` into Zustand (even with `partialize`). They'd land in MMKV cleartext. See `state-zustand.md` and `storage-and-crypto.md`.
- Skipping the state-mismatch check on the callback. Without it the route accepts arbitrary `code` values from any caller that can reach the redirect URI.

## Decision Rationale

See `../decisions.md` for why tokens live in SecureStore (split across keys) while `user` lives in Zustand, why `ConvexProviderWithAuth` mounts at the root (and why that is now safe), and why `react-native-quick-crypto` — not `Math.random()`, not `expo-crypto` — is the source of `state` and `code_verifier` bytes.
