---
name: review
description: Code review checklist for this codebase — reviewer-question form mirroring validation.md across architecture, routing, styling, forms, storage, Convex, observability, and auth, with a final Coding Standards keyword pass.
---

# Code Review Checklist

## Purpose

This list is for the reviewer, not the author. Each item is phrased as a question the reviewer asks of the diff. The answers should be obvious from reading the code; if they aren't, request changes. The final **Coding Standards** section is a quick keyword pass — every box must be checkable before approving.

## Patterns

### Architecture (import direction)

- [ ] Does any new `lib/**` file import from `@/app` or `@/components`? (It must not.)
- [ ] Does any new `components/**` file import from `@/app`? (It must not.)
- [ ] Does any new `stores/**` file perform network I/O, call `convex/react`, or import from `@/app`/`@/components`? (It must not.)
- [ ] Did the author reach for `expo-secure-store`, `convex/react`, WorkOS, PostHog, or Sentry directly inside `app/` instead of the `lib/` adapter?
- [ ] Are cross-layer imports using `@/`, with relative paths reserved for intra-layer siblings?
- [ ] Do any new `convex/**` files import RN/Expo modules or app-side code?

### Routing (Expo Router)

- [ ] Are auth gates implemented as `<Redirect href="..." />` rather than `router.replace(...)` during render or in an effect that fires on every render?
- [ ] Is every `router.push` / `router.replace` inside an event handler or a post-mount effect with a guard?
- [ ] Are route hrefs typed strings (typedRoutes), with no `as any` escape hatches?
- [ ] Are `(auth)` / `(tabs)` groups used to share layout without leaking into the URL?
- [ ] Are global providers added only in `app/_layout.tsx`, not in nested layouts?

### Styling (Tamagui)

- [ ] Any raw hex colors or px units introduced in the diff?
- [ ] Any inline `style={{ ... }}` for spacing/color that should be Tamagui props + tokens (`$color`, `$space`, `$size`, `$radius`)?
- [ ] Are variants declared via `styled(...).variants` instead of branching on theme inside JSX?
- [ ] Is `TamaguiProvider` wrapping confined to `app/_layout.tsx`?

### Forms (RHF + Zod)

- [ ] Does every new form use `react-hook-form` + a Zod schema via `@hookform/resolvers/zod`?
- [ ] Are fields rendered through the shared `FormField` wrapper, not bespoke `<Controller>` + `<Input>` pairings?
- [ ] Is the submit handler typed off `z.infer<typeof schema>` rather than a duplicated TS interface?
- [ ] Are server errors surfaced via `setError('root.serverError', ...)` instead of a separate state variable?

### Storage (SecureStore vs MMKV)

- [ ] Do any new tokens / refresh tokens / secrets land in MMKV, AsyncStorage, or Zustand instead of `expo-secure-store`?
- [ ] Do any non-sensitive persisted values live in SecureStore (slow, encrypted) when MMKV would do?
- [ ] Does any new Zustand `persist` omit `partialize`, or include a sensitive field in it?

### Convex

- [ ] Does every new query / mutation / action use the args shorthand with `v.*` validators?
- [ ] Does every new function declare a `returns` validator (or `v.null()`)?
- [ ] Are DB filters expressed as `.withIndex(...)` (with the index declared in `schema.ts`), reserving `.filter(...)` for post-index narrowing?
- [ ] Do auth-required functions guard with `await ctx.auth.getUserIdentity()` and throw on `null` before any DB access?
- [ ] Any `Math.random()` / `Date.now()` inside a query? (Use `ctx.scheduler` or input args.)
- [ ] Was `bunx convex codegen` run, and is the regenerated `convex/_generated/*` staged?

### Observability (Sentry + PostHog)

- [ ] Is `Sentry.init({...})` at module scope (in `lib/sentry.ts`, imported on the first line of `app/_layout.tsx`), not in a hook or lazy helper?
- [ ] Is the default export `Sentry.wrap(RootLayout)`?
- [ ] Is `Sentry.expoRouterIntegration()` present in `integrations` (not `reactNavigationIntegration`)?
- [ ] Is the DSN read as `EXPO_PUBLIC_SENTRY_DSN` (not unprefixed `SENTRY_DSN`)?
- [ ] Is `RootErrorBoundary` the outermost component in `RootLayout`'s return, with a fallback that uses **raw RN primitives + hex** (no Tamagui)?
- [ ] Does every new `catch` block call `log.error(...)` / `Sentry.captureException(...)` OR include a `// ignore: <reason>` comment as the first line?
- [ ] Any new `console.log` / `console.warn` / `console.error` outside `lib/log.ts`?
- [ ] Only one `PostHogProvider`, mounted in `app/_layout.tsx`, with `captureScreens: false`, and `<PostHogInstrumentation/>` mounted once inside it (handling screen/identify/reset)?

### Auth

- [ ] Any `Math.random()` used for nonces, state, or PKCE verifiers? (Must be `expo-crypto` or `react-native-quick-crypto`.)
- [ ] Is Convex auth driven by the root `ConvexProviderWithAuth` + `useAuth()` only — with **no** `useConvexAuthBridge`/`convexClient.setAuth(...)` reintroduced in a layout or screen?
- [ ] Are tokens written via the **split** SecureStore keys (access/refresh/id/meta), not one JSON blob?
- [ ] Does `refreshAccessToken` clear tokens only on `invalid_grant` (and throw on 429/5xx/network), preserving tokens offline?
- [ ] Are tokens kept out of Zustand (only the user profile is persisted, and `partialize` enforces it)?
- [ ] Does the sign-out path clear: SecureStore tokens and the auth Zustand store (PostHog reset / Sentry user are handled by `PostHogInstrumentation` / your session helper)?

### Tooling

- [ ] Did pre-commit hooks run clean (Biome + tsc)?
- [ ] Did pre-push run clean (Jest)?
- [ ] For navigation/UX-touching changes: were Maestro flows updated/added and did `just e2e` pass?
- [ ] No new `bunx ...` calls in CI or docs that should be a `just` recipe?
- [ ] No new `npm`/`yarn`/`pnpm` lockfile snuck in alongside `bun.lockb`?

## Coding Standards

Keyword-only pass. Every box must be checked before approving.

- [ ] **DRY** — no copy-pasted logic that should be a shared helper in `lib/` or a shared component in `components/`.
- [ ] **KISS** — the simplest change that solves the problem; no speculative abstractions.
- [ ] **YAGNI** — no "we might need it later" config options, generics, or branches with no current caller.
- [ ] **SoC** — each module owns one concern; route screens compose, services own SDKs, stores own state, Convex owns the backend contract.
- [ ] **Boy Scout Rule** — the diff leaves nearby code at least as clean as it found it (no broken-window neighbors left behind).
- [ ] **Fail-Fast** — invalid input / missing env / unauthorized access throws immediately at the boundary, not three layers in.
- [ ] **SOLID (DIP)** — screens depend on `lib/` abstractions (functions/types), not on concrete SDKs; stores and Convex calls are injected via hooks, not module-level singletons reached from app code.
- [ ] **POLA** — the code does what its name and shape promise; no hidden side effects, no surprise re-renders, no silent fallbacks where a throw is expected.

## Anti-Patterns

- **Rubber-stamping after the tooling section passes green.** Green CI proves the gate ran; it does not prove the architecture is sound. The reviewer-questions above are where humans add value.
- **Approving without running the diff locally** when the change touches navigation, native deps, or `app.config.ts`. These rarely break in unit tests; they break in `just ios` / `just android`.
- **Letting "we'll fix it in a follow-up" land.** Follow-ups for cross-layer import violations or silent catches almost never happen, and they degrade the codebase faster than any feature ages it.

## Decision Rationale

- **Question form, not assertion form.** A checklist of "no X" is easy to skim and miss; a checklist of "is X true?" forces the reviewer to look.
- **Coding Standards last and keyword-only** because by the time the eight section checks pass, the standards almost always pass too — but the explicit boxes catch the edge case where they don't.
- **DIP under SOLID is called out specifically** because it is the SOLID principle this codebase enforces most actively (`lib/` adapters, store injection via hooks). The others are implicit in the section checks above.
