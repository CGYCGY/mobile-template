import { secureDelete, secureGet, secureSet } from '@/lib/storage';

const PREFIX = 'mobile-template:auth';

// Split across keys instead of one JSON blob: two JWTs plus the user payload
// routinely exceed expo-secure-store's ~2048-byte per-item limit, and a write
// over that limit can fail SILENTLY — leaving a half-written or stale entry.
const KEYS = {
  accessToken: `${PREFIX}-access-token`,
  refreshToken: `${PREFIX}-refresh-token`,
  idToken: `${PREFIX}-id-token`,
  meta: `${PREFIX}-meta`,
} as const;

// expiresAt + user are small; bundling them keeps two reads instead of four.
type TokenMeta = {
  expiresAt: number;
  user?: WorkosUserPayload;
};

export type WorkosUserPayload = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_picture_url?: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  user?: WorkosUserPayload;
};

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  const meta: TokenMeta = { expiresAt: tokens.expiresAt, user: tokens.user };
  await Promise.all([
    secureSet(KEYS.accessToken, tokens.accessToken),
    secureSet(KEYS.refreshToken, tokens.refreshToken),
    tokens.idToken
      ? secureSet(KEYS.idToken, tokens.idToken)
      : secureDelete(KEYS.idToken),
    secureSet(KEYS.meta, JSON.stringify(meta)),
  ]);
}

export async function getTokens(): Promise<AuthTokens | null> {
  const [accessToken, refreshToken, idToken, rawMeta] = await Promise.all([
    secureGet(KEYS.accessToken),
    secureGet(KEYS.refreshToken),
    secureGet(KEYS.idToken),
    secureGet(KEYS.meta),
  ]);

  if (!accessToken || !refreshToken || !rawMeta) return null;

  try {
    const meta = JSON.parse(rawMeta) as TokenMeta;
    return {
      accessToken,
      refreshToken,
      idToken: idToken ?? undefined,
      expiresAt: meta.expiresAt,
      user: meta.user,
    };
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    secureDelete(KEYS.accessToken),
    secureDelete(KEYS.refreshToken),
    secureDelete(KEYS.idToken),
    secureDelete(KEYS.meta),
  ]);
}
