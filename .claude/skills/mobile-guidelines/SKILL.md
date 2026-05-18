---
name: mobile-guidelines
description: Enforces mobile development standards for this codebase — React Native + Expo + Expo Router + Tamagui + Zustand + Convex + WorkOS PKCE + Sentry + PostHog. Use when authoring or reviewing screens, components, stores, lib helpers, Convex functions, or native config. Loads relevant references on demand; do not preload everything.
---

# Mobile Development Guidelines

## Purpose

Enforces comprehensive mobile development standards for this codebase. Covers routing, styling, state, storage, auth, backend (Convex), observability, native config, and tooling.

## Architecture

**Pattern:** Layered, file-based routing
**Language:** TypeScript (strict + `noUncheckedIndexedAccess`)
**Runtime:** React Native + Expo SDK (New Architecture)
**Router:** Expo Router v6 (`typedRoutes` enabled)
**UI:** Tamagui (single styling source) + Lucide via `@/components/icons`
**State:** Zustand v5 + MMKV `persist` (user-state only — tokens in SecureStore)
**Backend:** Convex (query / mutation / action) — replaces ORM + REST controller layer
**Auth:** WorkOS via PKCE (`lib/auth/`), tokens in SecureStore, Convex JWT bridge mounted post-auth
**Observability:** Sentry (`@sentry/react-native`) + PostHog (`posthog-react-native`)
**Tooling:** Bun · Biome · Lefthook · Jest · Maestro · `just`

Path alias: `@/*` → project root.

## Process

### 1. Identify Task Context

- **Layer**: `app/` (route) · `components/` (UI) · `lib/` (service) · `stores/` (Zustand) · `convex/` (backend)
- **Operation**: read / write / external I/O / route-level UX / native config / build
- **Imports flow downward only:** `app/` → `components/` → `lib/` → `stores/` → `convex/_generated/`. Never reverse.

### 2. Load Relevant References

Progressive loading — only read what the current task needs.

**Foundation**
- `reference/architecture.md` — layer responsibilities + import direction
- `reference/expo-router-patterns.md` — groups, nested layouts, Redirect gates, typedRoutes
- `reference/platform-differences.md` — iOS vs Android divergences exercised here

**UI & forms**
- `reference/tamagui-patterns.md` — tokens-only styling
- `reference/components-and-forms.md` — primitives barrel + RHF/Zod via FormField

**State, storage, auth**
- `reference/state-zustand.md` — typed `create<T>()`, MMKV `persist`, `partialize`
- `reference/storage-and-crypto.md` — SecureStore vs MMKV decision matrix, quick-crypto
- `reference/auth-workos-pkce.md` — sign-in/refresh/sign-out and the Convex bridge

**Backend**
- `reference/convex-patterns.md` — args shorthand, returns validator, indexes, auth guard
- `reference/convex-paired-mode.md` — standalone vs paired ownership + codegen ordering

**Integrations**
- `reference/observability-sentry.md` — module-scope init, `Sentry.wrap`, navigation integration
- `reference/observability-posthog.md` — single provider instance, manual `screen()`, identify/reset
- `reference/r2-uploads.md` — presigned PUT via Convex action + `FileSystem.uploadAsync`
- `reference/push-notifications.md` — startup setup + Expo push token + Convex fan-out

**Build & runtime**
- `reference/env-and-config.md` — Zod-validated env + `app.config.ts` + `runtimeVersion`
- `reference/eas-and-ota.md` — three profiles, OTA safety rule
- `reference/tooling.md` — Bun + `just` + Biome + Lefthook + Jest + Maestro
- `reference/error-handling.md` — `lib/log.ts`, mandatory Sentry capture, RootErrorBoundary

**Examples** (annotated walkthroughs)
- `examples/root-layout.md` · `examples/auth-gated-tabs.md` · `examples/convex-query-pattern.md` · `examples/feature-with-form.md` · `examples/r2-upload-flow.md`

### 3. Check Against Standards

Locked decisions are recorded in `decisions.md`. Read it before debating a pattern. Key invariants:

- Tokens → SecureStore. Prefs/user → MMKV. Never the other way.
- Crypto-random for security values → `QuickCrypto.randomBytes(...)`. Never `Math.random()`.
- Convex `args:` shorthand · `returns:` validator required · `.withIndex` over `.filter` · auth guard at top.
- Mobile imports only from `@/convex/_generated/api` — never `convex/<feature>.ts`.
- Run `bunx convex codegen` before `tsc`. No `as FunctionReference<...>` casts.
- Sentry init at module scope. `Sentry.wrap(RootLayout)` on the default export.
- PostHog: single provider-managed instance. `captureScreens: false`. Manual `posthog.screen()`.
- `useConvexAuthBridge` mounted in `(tabs)/_layout.tsx` (post-auth), not in `app/_layout.tsx`.
- Tamagui tokens only. No `StyleSheet.create`, no raw hex, no raw px on layout props.
- `<Redirect>` for auth gates. Never `router.replace` during render.

### 4. Validate

Before committing, walk through:
- `checklists/validation.md` — pre-commit checklist (architecture → tooling)
- `checklists/review.md` — reviewer-question form + coding standards keywords

### 5. Run Tooling Validation

```bash
# Refresh Convex generated bindings first — TypeScript depends on them
bunx convex codegen

# Biome lint + format + import sort (replaces ESLint + Prettier)
just check          # wraps: bunx biome check --write .

# TypeScript
just typecheck      # wraps: bunx tsc --noEmit

# Unit tests
bun test            # or: just test

# E2E (when navigation/UX changed)
just e2e            # wraps: maestro test .maestro/
```

**CRITICAL:** Fix ALL Biome and TypeScript errors before committing. Lefthook gates this on `pre-commit` (Biome + tsc) and `pre-push` (Jest); when hooks are bypassed, run the full sequence manually.

## Quick Reference

| Situation | Rule |
|---|---|
| Pressable area | Tamagui `<Button>` wrapper from `@/components/ui/Button` |
| List > ~20 rows | `FlatList` with stable `keyExtractor` + memoized `renderItem` |
| Color / spacing | `$color` / `$space` tokens — no raw hex, no raw px |
| Tokens | SecureStore (`lib/storage/secure`) |
| User profile / prefs / cache | MMKV via `lib/storage/mmkv` |
| Random for security (state, PKCE) | `QuickCrypto.randomBytes(...)` |
| Read from backend | Convex `query` + `.withIndex(...)` |
| Write to backend | Convex `mutation` |
| External I/O (HTTP, signing) | Convex `action` |
| Form | RHF `useForm` + `zodResolver` + `<FormField>` |
| Navigation gate | `<Redirect>` in `_layout.tsx` |
| Navigation transition | `<Link>` in JSX; `router.push/replace` only in handlers/effects |
| Icon | Re-exported from `@/components/icons` (never direct from `lucide-react-native`) |
| Provider mount | Root layout only; never in screens |
| Sentry init | Module scope at top of `app/_layout.tsx` |
| PostHog screen tracking | Manual `posthog.screen(name)` — `captureScreens: false` |
| Convex function | `args:` shorthand · `returns:` validator · auth guard · `withIndex` |
| Convex import | Only from `@/convex/_generated/api` |

## Supporting Files

- `reference/` — Detailed technical patterns (load on demand)
- `examples/` — Annotated walkthroughs of real code
- `checklists/` — Pre-commit + review checklists
- `decisions.md` — Locked decisions log (read before deviating)

## Key Principles

- **Coding Standards**: DRY, KISS, YAGNI, SoC, Boy Scout Rule, Fail-Fast, SOLID (DIP for store/Convex injection), POLA
- **Load Only What You Need**: Read references progressively based on the layer you're touching
- **Check Decisions First**: Review `decisions.md` before relitigating a pattern
- **Validate Before Commit**: Use `checklists/validation.md`
- **Reference Real Code**: Point to actual files in this codebase, not generic examples
