---
name: tooling
description: Bun + just + Biome + Lefthook + Jest + Maestro toolchain for this codebase — one runtime, one task runner, one linter/formatter, two hook gates, two test layers, with a manual fallback when hooks are bypassed.
---

# Tooling

## Purpose

This codebase has exactly one of each: one package manager (Bun), one task runner (`just`), one linter/formatter (Biome), one Git-hook manager (Lefthook), one unit test runner (Jest), one E2E runner (Maestro). The point is to remove the "which command do I run" question — every workflow has a `just` recipe, every commit goes through the same hooks, every CI step calls the same recipes a human would. The toolchain is opinionated so that a developer joining a fork can be productive in ten minutes.

## Patterns

### 1. Bun is the runtime and package manager

The lockfile is `bun.lockb`. Use `bun install` to install, `bun run <script>` for `package.json` scripts, and `bunx <cli>` to invoke a binary without a global install. Do **not** introduce `npm`, `yarn`, or `pnpm` — mixed lockfiles drift and break Lefthook on first run.

```bash
bun install                  # restore deps
bun run start                # underlying expo start --dev-client
bunx convex codegen          # regenerate Convex client types
bunx eas build --profile preview
```

### 2. `just` is the task runner — list every recipe

Every common command is a `just` recipe. Run `just --list` to see them. The relevant groups:

```just
# justfile (grouped)

# dev
just dev            # tmux split: convex dev + expo start
just dev-stop       # kill both
just start          # bun run start              → expo start --dev-client
just ios            # bun run ios                → expo run:ios
just android        # bun run android            → expo run:android
just prebuild       # bun run prebuild           → expo prebuild

# convex
just convex-dev     # bunx convex dev (with CONVEX_TMPDIR for WSL)
just convex-codegen # bunx convex codegen
just convex-deploy  # bunx convex deploy
just env-set KEY V  # bunx convex env set
just env-list       # bunx convex env list
just env-sync       # syncs WORKOS_*/R2_* from .env.local → Convex

# build / OTA
just build-ios *args     # bunx eas build --platform ios
just build-android *args # bunx eas build --platform android
just submit-ios *args    # bunx eas submit --platform ios
just submit-android *args
just ota *args           # bunx eas update

# quality
just typecheck      # bun run typecheck          → tsc --noEmit
just lint           # bun run lint               → biome lint .
just fmt            # bun run format             → biome format --write .
just check          # bun run check              → biome check --write . (lint+format+imports)
just test           # bun run test               → jest
just e2e            # bun run test:e2e           → maestro test e2e/

# deps
just install        # bun install
just update         # bun update
```

If a workflow lacks a recipe, add one. Don't paste raw `bunx ...` in docs or CI.

### 3. Biome — the only linter and formatter

Biome replaces ESLint, Prettier, and `eslint-plugin-simple-import-sort` simultaneously. One config file, one CLI:

```json
// biome.json
{
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "jsxQuoteStyle": "double" } },
  "assist": {
    "enabled": true,
    "actions": { "source": { "organizeImports": "on" } }
  }
}
```

`just check` runs `biome check --write .` — that one command lints, formats, and sorts imports. Don't add `.prettierrc`, `.eslintrc*`, or any import-sort plugin.

### 4. Lefthook gates — pre-commit and pre-push

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: "*.{js,ts,jsx,tsx,json,jsonc}"
      run: bunx biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true
    typecheck:
      glob: "*.{ts,tsx}"
      run: bunx tsc --noEmit

pre-push:
  commands:
    jest:
      run: bun run test
```

- **pre-commit (parallel)** — Biome auto-fixes and re-stages, plus full `tsc --noEmit`. Fast enough on every commit because Biome is Rust-fast and `tsc` is incremental.
- **pre-push** — full Jest suite. Slow enough that it belongs at push time, not commit time.

Lefthook installs on `postinstall` (`package.json:21`). If hooks are missing after a fresh clone, run `bunx lefthook install`.

### 5. Manual fallback gate (when hooks are bypassed)

CI must reproduce the local gate, and engineers who `git commit --no-verify` (don't) need a recovery path. The full sequence:

```bash
bunx convex codegen   # refresh generated types FIRST (typecheck depends on them)
just check            # biome lint + format + organize imports
just typecheck        # tsc --noEmit
bun test              # jest
# optional:
just e2e              # maestro, requires a built dev client on simulator/device
```

The `convex codegen` step must run **before** `typecheck` — `tsc` reads `convex/_generated/api.d.ts`, and a stale file masks real type errors. The same ordering applies in CI workflows.

### 6. Jest preset and module mapping

```js
// jest.config.js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEach: ['./jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|...|tamagui|@tamagui/.*|posthog-react-native|@workos-inc/.*))',
  ],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/ios/', '/android/', '/.expo/', '/dist/'],
};
```

The `jest-expo` preset wires React Native + Expo's Jest config. The `transformIgnorePatterns` exception list must include every native-flavored package the test imports — when a new ESM-only RN library is added, append its scope here. The `@/*` alias mirrors `tsconfig.json:14`.

### 7. Maestro E2E lives under `e2e/`

```bash
just e2e              # bun run test:e2e → maestro test e2e/
```

Maestro flows are YAML files in `e2e/`. They need a built dev client on a simulator or device (use `just ios` / `just android` first). CI runs Maestro on real devices via EAS Build's Maestro integration; locally it runs against your simulator. Keep flow files tiny — one user journey per file.

## Anti-Patterns

- **Using `npm`/`yarn`/`pnpm` alongside Bun.** Two lockfiles means two truths; one will silently win and break CI. Delete `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` if you find them.
- **Adding ESLint / Prettier configs.** Biome already lints, formats, and sorts. A second tool with overlapping rules will fight `lefthook.yml:6` on every commit.
- **Running raw `bunx ...` in CI.** CI should call `just <recipe>` so the local-CI gap stays at zero. If CI diverges, fix the recipe.
- **Skipping `convex codegen` before typecheck.** A stale `convex/_generated/api.d.ts` lets `tsc` pass against a backend that has since changed. Always run codegen first.
- **`git commit --no-verify` as a habit.** The pre-commit gate is fast (parallel Biome + incremental tsc). Bypassing it shifts the failure to CI or production.
- **Adding a native ESM package without updating `jest.config.js:6`.** Tests fail with `SyntaxError: Unexpected token 'export'` and the cause is one missing entry in `transformIgnorePatterns`.

## Decision Rationale

- **Bun over npm** — faster install, faster script execution, lockfile-stable. The `packageManager` field in `package.json:6` pins it.
- **`just` over npm scripts** — recipes can compose, take args, and group; `package.json:scripts` cannot. The two coexist (each recipe wraps one script), so `bun run` still works.
- **Biome over ESLint + Prettier** — one tool, one config, one process. Biome's lint is fast enough to run on every commit; ESLint isn't.
- **Lefthook over Husky** — declarative YAML, parallel by default, no `node_modules/.bin/husky install` script needed.
- **`jest-expo` over plain Jest** — the preset handles RN's Babel + Metro quirks; rolling your own is a maintenance trap.
