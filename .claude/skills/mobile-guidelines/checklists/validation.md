---
name: validation
description: Pre-commit validation checklist for this codebase — section-by-section conformance gates across architecture, routing, styling, forms, storage, Convex, observability, and auth, followed by the mandatory tooling sequence.
---

# Validation Checklist

## Purpose

Run this list before every commit. It is not "nice to have" — every item maps to a real failure mode the codebase has seen or that the layered architecture is designed to prevent. The first eight sections are pattern checks (humans audit). The final **Tooling Validation** section is non-negotiable: it is exactly what Lefthook and CI run, and skipping it locally only shifts the failure to push or CI.

## Patterns

### Architecture (import direction)

- [ ] No file in `lib/**` imports from `@/app` or `@/components`.
- [ ] No file in `components/**` imports from `@/app`.
- [ ] No file in `stores/**` imports from `@/app` or `@/components`, and does not call `fetch` or `convex/react` directly (storage adapter only).
- [ ] No direct `expo-secure-store`, `convex/react` client construction, WorkOS SDK, PostHog, or Sentry imports inside `app/` — go through the `lib/` adapter.
- [ ] Cross-layer imports use the `@/` alias; relative `../../` paths are intra-layer only.
- [ ] Files added under `convex/**` do not import RN/Expo modules and do not depend on `app/`, `components/`, `lib/`, or `stores/`.

### Routing (Expo Router)

- [ ] Auth gating uses `<Redirect href="..." />` inside the route component — never `router.replace(...)` from inside `useEffect` or render.
- [ ] No navigation side-effect (`router.push` / `router.replace`) runs during render; navigation lives in event handlers or post-mount effects.
- [ ] Route hrefs are typed strings — `typedRoutes: true` in `app.config.ts:60` is on, so a typo is a TS error.
- [ ] Route group folders `(auth)` and `(tabs)` are used to share layouts without affecting URLs.
- [ ] `app/_layout.tsx` is the only place that mounts global providers; nested layouts only add navigator-level scoping.

### Styling (Tamagui)

- [ ] No raw hex colors (`#ffffff`), no raw px units in JSX, no inline `style={{ ... }}` for spacing/color — use Tamagui props and tokens (`$color`, `$space`, `$size`, `$radius`).
- [ ] Component variants are declared via `styled(...).variants`; do not branch on theme inside JSX.
- [ ] One `TamaguiProvider` in `app/_layout.tsx`; do not re-wrap in screens.

### Forms (RHF + Zod)

- [ ] Every form uses `react-hook-form` with a Zod schema via `@hookform/resolvers/zod`.
- [ ] Field UI goes through the shared `FormField` wrapper — no ad-hoc `<Controller>` + `<Input>` pairings per form.
- [ ] Submit handlers are typed off the Zod schema's inferred type (`z.infer<typeof schema>`), not hand-written interfaces.
- [ ] Server-side validation errors are surfaced via `setError('root.serverError', ...)`, not a separate state variable.

### Storage (SecureStore vs MMKV)

- [ ] Secrets, tokens, refresh tokens → `expo-secure-store` (via `lib/auth/tokens.ts` or equivalent adapter).
- [ ] Non-sensitive client state (theme, last-seen ids, persisted Zustand stores) → MMKV (via `lib/storage`).
- [ ] No token, refresh token, or PII enters Zustand or AsyncStorage.
- [ ] Zustand `persist` middleware uses `createJSONStorage(() => mmkvStorage)` and a `partialize` that excludes anything sensitive.

### Convex

- [ ] Every query / mutation / action uses the args shorthand: `args: { ... }` with `v.*` validators — not the legacy two-argument form.
- [ ] Every query / mutation / action declares a `returns` validator (or `v.null()` for fire-and-forget mutations).
- [ ] Database reads use `.withIndex(...)` (with an index declared in `schema.ts`) when filtering by a column; `.filter(...)` is reserved for post-index narrowing.
- [ ] Auth-required functions guard with `await ctx.auth.getUserIdentity()` and throw on `null` before any DB read.
- [ ] No `Math.random()` or `Date.now()` inside queries — use `ctx.scheduler` / `crypto` / inputs.
- [ ] After backend changes, `bunx convex codegen` was run and the generated diff is staged.

### Observability (Sentry + PostHog)

- [ ] `Sentry.init({...})` is at module scope in `app/_layout.tsx`, before the component declaration — not inside a hook or a lazy helper.
- [ ] `export default Sentry.wrap(RootLayout)` is the default export (`app/_layout.tsx:82`).
- [ ] `integrations: [Sentry.reactNavigationIntegration({...})]` is present.
- [ ] `RootErrorBoundary` is the outermost component returned from `RootLayout`.
- [ ] All `catch` blocks either call `log.error(...)` / `Sentry.captureException(...)` or have a `// ignore: <reason>` comment.
- [ ] No `console.*` outside `lib/log.ts` (each call there has a `biome-ignore lint/suspicious/noConsole` comment).
- [ ] PostHog: a single `PostHogProvider` mounted from `app/_layout.tsx`; no second `posthog-react-native` instance elsewhere.
- [ ] PostHog is configured with `captureScreens: false` — screens are tracked via `Sentry.reactNavigationIntegration`, not duplicate PostHog autocapture.

### Auth

- [ ] No `Math.random()` for nonces, state, or PKCE verifiers — use `expo-crypto` / `react-native-quick-crypto`.
- [ ] `useConvexAuthBridge` (or equivalent token-injection hook) is mounted **post-auth**, inside the authenticated route group, not in `_layout.tsx`.
- [ ] Tokens never enter Zustand; only the user profile object does, and persistence uses `partialize` to keep tokens out of storage.
- [ ] Sign-out clears: Sentry user (`Sentry.setUser(null)`), PostHog (`posthog.reset()`), SecureStore tokens, and the auth Zustand store (`clear()`).

## Tooling Validation (CRITICAL — run in this order)

These four are the gate. The fifth is conditional but recommended. Order matters: codegen feeds typecheck, typecheck feeds the test suite's type-aware assertions.

- [ ] **`bunx convex codegen`** — regenerate `convex/_generated/api.d.ts` so types reflect the current backend.
- [ ] **`just check`** — `biome check --write .` (lint + format + organize imports). Re-stage any auto-fixes.
- [ ] **`just typecheck`** — `tsc --noEmit` clean across the project.
- [ ] **`bun test`** — Jest suite passes.
- [ ] **`just e2e`** _(optional, but required for any navigation / UX touch change)_ — Maestro flows pass against a built dev client on a simulator or device.

If any of the four mandatory steps fails, do not commit. Lefthook will block you anyway on `pre-commit` (Biome + tsc) and `pre-push` (Jest); running them locally first saves a round-trip.

## Anti-Patterns

- **"I'll let CI catch it."** CI runs the same recipes — the failure happens either way, just five minutes later with a worse stack trace.
- **`git commit --no-verify`.** Bypassing the hooks means the next reviewer sees a broken build. If a hook is genuinely wrong (rare), fix the hook.
- **Skipping `convex codegen` before typecheck.** A stale generated file lets `tsc` pass against a backend that no longer matches; the OTA crashes at the first `useQuery`.
- **Running `bun test` before `tsc`.** Tests rely on Jest's type stripping but won't catch generic-level mismatches that `tsc --noEmit` would. Both must pass.
- **Auto-fix surprises.** `biome check --write` re-stages fixes (`lefthook.yml:7` `stage_fixed: true`). Always re-review the diff after `just check`.

## Decision Rationale

- **Section ordering reflects blast radius.** Architecture violations corrupt the whole codebase; routing bugs corrupt navigation; styling/forms bugs corrupt one screen. Audit top-down so the worst classes of bug surface first.
- **Tooling Validation is last and non-skippable** because it is the only objective gate — the sections above need human judgement; the four commands need none.
- **Codegen → check → typecheck → test** is the dependency order. Reversing it produces false greens (tests pass on stale generated types).
- **E2E is optional by default** because Maestro flows require a running simulator and a built dev client — too heavy for every commit, mandatory for any navigation change.
