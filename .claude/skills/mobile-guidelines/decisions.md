# Standardization Decisions

This file records the locked decisions that shaped these guidelines. Each entry has a date, the decision, and the rationale. When a future contributor wants to deviate, they should update this file and re-justify — not silently drift.

---

## Provider wrap order in the root layout

**Date:** 2026-05-19
**Decision:** The root layout (`app/_layout.tsx`) wraps providers in this exact order from outermost to innermost:

```
RootErrorBoundary               (raw-RN fallback — must NOT use Tamagui)
  └─ PostHogProvider
       ├─ PostHogInstrumentation (sibling: screen()/identify()/reset())
       └─ TamaguiProvider
            └─ Theme name={effectiveTheme}
                 └─ ConvexProviderWithAuth (client + useAuth)
                      └─ GestureHandlerRootView
                           └─ SafeAreaProvider
                                └─ Stack (Expo Router)
```

**Rationale:**
- `RootErrorBoundary` is outermost so it catches errors from every provider below it. Because it wraps `TamaguiProvider`, its fallback UI uses **raw React Native primitives + hex colors** — a Tamagui-based fallback would re-throw when the crash is a TamaguiProvider failure. See `reference/error-handling.md`.
- `PostHogProvider` and `TamaguiProvider` need to live above any screen that emits events or styles. `PostHogInstrumentation` mounts inside the provider so `usePostHog()` is available.
- A `<Theme name={...}>` wrapper sits below `TamaguiProvider` because Tamagui v2 needs an explicit `<Theme>` for correct theme propagation; `defaultTheme` alone is not enough.
- `ConvexProviderWithAuth` is below theming so screens can render a loading state in the right theme; it is driven by `useAuth()` and fetches a token only once authenticated.
- `GestureHandlerRootView` + `SafeAreaProvider` are the React Native runtime boundaries — they go last (closest to screens) because they don't need to wrap context providers.

**How to apply:** Do not reorder. If you add a new provider, place it according to: error boundary first, app-wide concerns next, RN runtime concerns last.

---

## Sentry initialization

**Date:** 2026-05-19
**Decision:** `Sentry.init({...})` is called at **module scope** in `lib/sentry.ts`, which `app/_layout.tsx` imports on its **first line** (`import '@/lib/sentry';`) so init runs before any React tree renders. The default export is wrapped with `Sentry.wrap(RootLayout)`. The integration is `expoRouterIntegration()` and the DSN is `EXPO_PUBLIC_SENTRY_DSN`. Do not wrap `Sentry.init` in a lazy helper that requires explicit invocation.

**Rationale:** Module-scope init runs before React's first render. Lazy init may miss early errors (e.g., during provider hydration) and creates a hidden coupling on whoever remembers to call the helper. Keeping it in `lib/sentry.ts` (imported first) also lets other modules `import { Sentry } from '@/lib/sentry'` without re-initializing.

**How to apply:** A new project that copies this codebase must verify `lib/sentry.ts` runs `Sentry.init` at module scope and that `app/_layout.tsx` imports it first — not lazily called. See `reference/observability-sentry.md`.

---

## PostHog instance ownership

**Date:** 2026-05-19
**Decision:** PostHog has a **single** instance, managed by the `<PostHogProvider apiKey={EXPO_PUBLIC_POSTHOG_KEY} options={{captureAppLifecycleEvents: true, captureScreens: false}}>` at the root (props live in `postHogProviderProps`, `lib/posthog.ts`). Consumers access it via `usePostHog()` from `posthog-react-native`. Do not create a standalone `posthog` client in a `lib/` file.

`captureScreens` is **false** because screen tracking is done manually via the `PostHogInstrumentation` component (`lib/posthog.ts`) for control over event names. Mounted once inside the provider, it fires `posthog.screen(pathname)` on every route change (driven by `usePathname`), calls `posthog.identify(user.id)` on sign-in, and `posthog.reset()` on sign-out — the reset is what stops one user's anonymous distinct_id from bleeding into the next on a shared device.

**Rationale:** Two instances means two queues, two flush cycles, and the risk of double-capturing events. Single source of truth makes identify/reset/feature-flag state coherent.

**How to apply:** See `reference/observability-posthog.md` for the canonical wiring.

---

## Auth state ownership

**Date:** 2026-05-19
**Decision:**
- `useAuthStore` (Zustand + MMKV `persist`) holds the `user` object only — `partialize` is used to persist a minimal slice.
- **Access, refresh, and id tokens live in SecureStore exclusively** — never in Zustand, never in MMKV. They are written across **separate keys** (access / refresh / id / meta), not one JSON blob: the combined two JWTs + user payload routinely exceed `expo-secure-store`'s ~2048-byte per-item limit, and an over-limit write can fail **silently**.
- Route gating is done with `<Redirect>` inside `app/(auth)/_layout.tsx` and `app/(tabs)/_layout.tsx`. Do not call `router.replace` during render.

**Rationale:** Tokens belong in the OS keychain (Keychain / Keystore via `expo-secure-store`). MMKV is fast but not encrypted at rest with hardware-backed keys. Mixing the two leaks secrets through Zustand's `persist`. Redirects in render cause warnings and re-render loops; the `<Redirect>` component is purpose-built for this.

**How to apply:** See `reference/auth-workos-pkce.md` and `reference/state-zustand.md`.

---

## Cryptographic randomness

**Date:** 2026-05-19
**Decision:** Any security-relevant random value (OAuth `state`, PKCE `code_verifier`, nonces, CSRF tokens) MUST come from `QuickCrypto.randomBytes(...)` from `react-native-quick-crypto`. `Math.random()` is forbidden for these purposes.

**Rationale:** `Math.random()` is not cryptographically secure. An attacker who can predict the OAuth `state` can mount a CSRF on the auth callback.

**How to apply:** Grep for `Math.random` before merging anything in `lib/auth/`. See `reference/storage-and-crypto.md`.

---

## Convex auth: root-mounted `ConvexProviderWithAuth`

**Date:** 2026-06-20 (supersedes the 2026-05-19 `useConvexAuthBridge` mount-point decision)
**Decision:** Convex auth is wired with `ConvexProviderWithAuth` mounted at the **root** in `app/_layout.tsx`, driven by the `useAuth()` hook (`lib/convex/use-auth.ts`) which returns `{ isLoading, isAuthenticated: !!user, fetchAccessToken }`. Token fetch is centralized in the module-scoped `fetchConvexAccessToken()` (`lib/convex/auth.ts`). There is **no** `useConvexAuthBridge` hook and no per-layout token-injection mount.

**Rationale:** Convex calls `fetchAccessToken` only when `isAuthenticated` is true. Pre-auth `user` is `null`, so the fetcher is never invoked on the sign-in screens — the old "null fetcher pre-auth storms `/authenticate`" failure mode (which previously forced a post-auth mount point) no longer exists. Root-mounting is therefore safe and removes the per-route-group bookkeeping the bridge required. `fetchConvexAccessToken` is dual-flighted (separate forced vs read in-flight) so a `forceRefreshToken: true` call never reuses a stale read.

**How to apply:** Do not add `useConvexAuthBridge()` (or any `convexClient.setAuth(...)` call) to a layout or screen. New post-auth route groups need nothing extra — the root provider already drives auth for the whole tree. See `reference/auth-workos-pkce.md`.

---

## Convex `args:` style

**Date:** 2026-05-19
**Decision:** Use the **shorthand** form for `args`:

```ts
export const completeOnboarding = mutation({
  args: { displayName: v.string(), bio: v.optional(v.string()) },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => { /* ... */ },
});
```

Do not use `args: v.object({...})`. Both work, but the shorthand is the Convex-documented style and is consistent across the rest of the codebase.

**Rationale:** Stylistic consistency. Mixed styles in one repo make the function-definition shape harder to grep.

**How to apply:** When adding a new Convex function, use shorthand. When editing an existing function, normalize if you're already touching the file.

---

## Convex `returns:` validators

**Date:** 2026-05-19
**Decision:** Every public `query`, `mutation`, and `action` MUST declare a `returns:` validator.

**Rationale:** The mobile client imports a generated `FunctionReference<"query"|"mutation"|"action", Args, Returns>`. Without a `returns:` validator, the `Returns` slot is inferred from the handler — which means refactoring the handler silently changes the wire shape and breaks the client. Declaring `returns:` makes the contract explicit and catches drift at codegen time.

**Cost:** A few extra lines per function.

**How to apply:** Add `returns: v.object({...})` (or `v.null()` if the function returns void) to all new functions. Backfill existing functions when touching them. See `reference/convex-patterns.md`.

---

## Convex codegen ordering

**Date:** 2026-05-19
**Decision:** Run `bunx convex codegen` **before** `tsc`. Type errors from stale codegen must be fixed at the source (re-run codegen), not papered over with `as FunctionReference<...>` casts.

**Rationale:** Stale codegen is a real bug — the wire contract has changed and the client doesn't know. Casting to `FunctionReference` hides this. Onboarding friction (fresh clones need codegen) is a small one-time cost.

**How to apply:** `just typecheck` should chain codegen first. CI runs codegen before typecheck. See `reference/convex-paired-mode.md`.

---

## Convex paired vs standalone mode

**Date:** 2026-05-19
**Decision:** This codebase supports two modes for the Convex backend:

- **Standalone:** This project owns `convex/` source files and runs codegen locally. The mobile TS build excludes `convex/` (see `tsconfig.json` `exclude`).
- **Paired:** A sibling web project owns `convex/` source. This project ships only `convex/_generated/` (committed). Both projects share the same `CONVEX_URL`.

In both modes: mobile code imports only from `@/convex/_generated/api`, never directly from `convex/<feature>.ts`.

**Rationale:** Convex is the single API for both surfaces. Editing source on both sides causes drift; centralizing on one side (or local-only if there's no web sibling) keeps the contract clean.

**How to apply:** Pick a mode on day one and document it in your project README. See `reference/convex-paired-mode.md`.

---

## Storage decision matrix

**Date:** 2026-05-19
**Decision:**

| Data type | Storage |
|---|---|
| Access / refresh / id tokens, OAuth state, PKCE verifier | SecureStore (tokens split across separate keys — see Auth state ownership) |
| User profile snapshot (via Zustand persist) | MMKV |
| UI prefs, theme, cached responses | MMKV |
| Anything biometric-gateable | SecureStore |

`AsyncStorage` is not used.

**Rationale:** SecureStore (`expo-secure-store`) uses the OS keychain (hardware-backed where available). MMKV is fast but not appropriate for secrets. Mixing them invites accidental leakage via Zustand persistence or logging.

**How to apply:** Before adding `setItem` anywhere, ask: is this a secret? If yes → SecureStore. If no → MMKV. See `reference/storage-and-crypto.md`.

---

## Tamagui as the only styling source

**Date:** 2026-05-19 (config bumped to v5 + Tamagui v2 settings on 2026-06-20)
**Decision:** Tamagui tokens (`$color`, `$space`, `$size`, etc.) are the only way to style components. No `StyleSheet.create`, no raw hex, no inline `style={{padding: 16}}` for spacing/colors. `styled()` for reusable variants; inline Tamagui props for one-offs.

Config specifics (`tamagui.config.ts`): the base is `@tamagui/config/v5` with the v5-reanimated `animations` driver wired in (v2 unbundles animations from the config). `settings.onlyAllowShorthands: false` is set because Tamagui v2 rejects longhand style props (`backgroundColor`, `alignItems`, …) by default and this codebase uses longhands. The animation prop on components was renamed `animation` → `transition` (see `components/ui/Sheet.tsx`).

**Rationale:** One styling system means consistent theming (dark mode, density variants) and one place to update tokens. Mixing `StyleSheet` and Tamagui produces a half-themed app.

**How to apply:** If a Tamagui prop doesn't exist for what you need (rare), use Tamagui's `style` prop with token references — still no raw values. See `reference/tamagui-patterns.md`.

---

## Coding standards (always enforced)

**Date:** 2026-05-19
**Decision:** Code review and pre-commit validation check for: **DRY, KISS, YAGNI, SoC, Boy Scout Rule, Fail-Fast, SOLID (DIP for store/Convex injection), POLA**.

**Rationale:** These are the standards relevant to the architecture of this codebase (file-based routing, Zustand stores, Convex client injection). They are not philosophical — they are checklist items.

**How to apply:** See `checklists/review.md` and `checklists/validation.md`.
