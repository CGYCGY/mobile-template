# Standardization Decisions

This file records the locked decisions that shaped these guidelines. Each entry has a date, the decision, and the rationale. When a future contributor wants to deviate, they should update this file and re-justify — not silently drift.

---

## Provider wrap order in the root layout

**Date:** 2026-05-19
**Decision:** The root layout (`app/_layout.tsx`) wraps providers in this exact order from outermost to innermost:

```
RootErrorBoundary
  └─ PostHogProvider
       └─ TamaguiProvider
            └─ ThemeProvider
                 └─ ConvexProvider
                      └─ GestureHandlerRootView
                           └─ SafeAreaProvider
                                └─ Stack (Expo Router)
```

**Rationale:**
- `RootErrorBoundary` is outermost so it catches errors from every provider below it.
- `PostHogProvider` and `TamaguiProvider` need to live above any screen that emits events or styles.
- `ConvexProvider` is below theming so screens can render a loading state in the right theme during auth bridge handoff.
- `GestureHandlerRootView` + `SafeAreaProvider` are the React Native runtime boundaries — they go last (closest to screens) because they don't need to wrap context providers.

**How to apply:** Do not reorder. If you add a new provider, place it according to: error boundary first, app-wide concerns next, RN runtime concerns last.

---

## Sentry initialization

**Date:** 2026-05-19
**Decision:** `Sentry.init({...})` is called at **module scope** at the top of `app/_layout.tsx` (or a file imported synchronously by it before any React tree renders). The default export is wrapped with `Sentry.wrap(RootLayout)`. Do not wrap `Sentry.init` in a lazy helper that requires explicit invocation.

**Rationale:** Module-scope init runs before React's first render. Lazy init may miss early errors (e.g., during provider hydration) and creates a hidden coupling on whoever remembers to call the helper.

**How to apply:** A new project that copies this codebase must verify `Sentry.init` is at the top of `app/_layout.tsx`, not lazily called. See `reference/observability-sentry.md`.

---

## PostHog instance ownership

**Date:** 2026-05-19
**Decision:** PostHog has a **single** instance, managed by the `<PostHogProvider apiKey={EXPO_PUBLIC_POSTHOG_KEY} options={{captureAppLifecycleEvents: true, captureScreens: false}}>` at the root. Consumers access it via `usePostHog()` from `posthog-react-native`. Do not create a standalone `posthog` client in a `lib/` file.

`captureScreens` is **false** because Expo Router v6 / React Navigation v7 break PostHog's autocapture wiring. Screen events are emitted manually via `posthog.screen(name, props)` from route effects (or a small hook).

**Rationale:** Two instances means two queues, two flush cycles, and the risk of double-capturing events. Single source of truth makes identify/reset/feature-flag state coherent.

**How to apply:** See `reference/observability-posthog.md` for the canonical wiring.

---

## Auth state ownership

**Date:** 2026-05-19
**Decision:**
- `useAuthStore` (Zustand + MMKV `persist`) holds the `user` object only — `partialize` is used to persist a minimal slice.
- **Access and refresh tokens live in SecureStore exclusively** — never in Zustand, never in MMKV.
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

## Convex `useConvexAuthBridge` mount point

**Date:** 2026-05-19
**Decision:** `useConvexAuthBridge` is mounted inside `app/(tabs)/_layout.tsx` (or any post-auth group layout). It is **not** mounted in `app/_layout.tsx`.

**Rationale:** The bridge pushes the WorkOS access token into the Convex client. It only makes sense after auth has completed. Mounting it at root means it runs on the auth screens too, where there is no token to push.

**How to apply:** New post-auth route groups (e.g., `app/(admin)/_layout.tsx`) must also call `useConvexAuthBridge()` at the top of their layout. See `reference/auth-workos-pkce.md`.

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
| Access tokens, refresh tokens, OAuth state, PKCE verifier | SecureStore |
| User profile snapshot (via Zustand persist) | MMKV |
| UI prefs, theme, cached responses | MMKV |
| Anything biometric-gateable | SecureStore |

`AsyncStorage` is not used.

**Rationale:** SecureStore (`expo-secure-store`) uses the OS keychain (hardware-backed where available). MMKV is fast but not appropriate for secrets. Mixing them invites accidental leakage via Zustand persistence or logging.

**How to apply:** Before adding `setItem` anywhere, ask: is this a secret? If yes → SecureStore. If no → MMKV. See `reference/storage-and-crypto.md`.

---

## Tamagui as the only styling source

**Date:** 2026-05-19
**Decision:** Tamagui tokens (`$color`, `$space`, `$size`, etc.) are the only way to style components. No `StyleSheet.create`, no raw hex, no inline `style={{padding: 16}}` for spacing/colors. `styled()` for reusable variants; inline Tamagui props for one-offs.

**Rationale:** One styling system means consistent theming (dark mode, density variants) and one place to update tokens. Mixing `StyleSheet` and Tamagui produces a half-themed app.

**How to apply:** If a Tamagui prop doesn't exist for what you need (rare), use Tamagui's `style` prop with token references — still no raw values. See `reference/tamagui-patterns.md`.

---

## Coding standards (always enforced)

**Date:** 2026-05-19
**Decision:** Code review and pre-commit validation check for: **DRY, KISS, YAGNI, SoC, Boy Scout Rule, Fail-Fast, SOLID (DIP for store/Convex injection), POLA**.

**Rationale:** These are the standards relevant to the architecture of this codebase (file-based routing, Zustand stores, Convex client injection). They are not philosophical — they are checklist items.

**How to apply:** See `checklists/review.md` and `checklists/validation.md`.
