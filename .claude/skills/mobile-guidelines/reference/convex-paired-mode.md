---
name: convex-paired-mode
description: Ownership rule for the Convex backend in standalone vs paired-with-web setups, codegen ordering, and how to add a new Convex function without breaking the mobile build.
---

# Convex Paired Mode

## Purpose

The Convex backend in this codebase is designed to be shared with a web sibling project. There are two supported modes:

- **Standalone** (default for a freshly-cloned codebase) — the mobile repo owns `convex/`, runs `bunx convex dev` / `bunx convex codegen` locally, and the deployment is mobile-only. Useful for evaluation and for mobile-only products.
- **Paired** — a web sibling owns the `convex/` source tree and runs `convex dev` / `convex deploy`. The mobile repo ships only `convex/_generated/` (committed or regenerated locally) and both apps share one Convex deployment via the same URL.

The rule for paired mode is structural: **one repo owns `convex/`, the other only consumes generated types**. Two source trees pointing at one deployment is the source of every "the mobile build compiles but the query returns the wrong shape" bug.

## Patterns

### Standalone mode (current shape of this codebase)

The `convex/` source tree exists in this repo, with its own tsconfig (`convex/tsconfig.json`) and is excluded from the mobile TS build.

```jsonc
// tsconfig.json
{
  "extends": "expo/tsconfig.base",
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["node_modules", "convex", "ios", "android", "dist", "build"]
}
```

See `tsconfig.json:24` — `convex` is in `exclude`. This is intentional: the Convex tree is type-checked by `bunx convex codegen` against its own tsconfig, and the mobile TS run never tries to compile server-side code (which would fail because `'use node'` directives, AWS SDK imports, etc. aren't valid in the RN bundler graph).

To add a function in standalone mode:

1. Author the file under `convex/` (e.g. `convex/posts.ts`).
2. Run `bunx convex codegen` — regenerates `convex/_generated/api.d.ts` so `api.posts.create` is typed.
3. Import on mobile from `@/convex/_generated/api` only.

```tsx
// app/(tabs)/index.tsx — standalone import shape
import { api } from '@/convex/_generated/api';
const me = useQuery(api.users.getMe);
```

The Convex URL is read from `EXPO_PUBLIC_CONVEX_URL`:

```ts
// lib/convex/client.ts
import { ConvexReactClient } from 'convex/react';
import { env } from '@/env';

export const convexClient = new ConvexReactClient(env.EXPO_PUBLIC_CONVEX_URL, {
  unsavedChangesWarning: false,
});
```

### Paired mode

The web sibling repo owns `convex/`. The mobile repo only contains `convex/_generated/`. Both apps point at the same deployment via the same URL value.

```
myapp-web/                    ← Convex owner
  convex/
    schema.ts
    users.ts
    r2.ts
    push.ts
    _generated/
  package.json                ← runs `bunx convex dev` / `bunx convex deploy`

myapp-mobile/                 ← consumer only
  convex/
    _generated/               ← pulled via `bunx convex codegen --url=...`
  package.json
```

Migration when pairing this codebase with a web sibling (from `docs/convex.md:34`):

1. In the mobile repo, delete the full `convex/` source: `rm -rf convex/` (then re-add `convex/_generated/`).
2. In the web repo, run `bunx convex dev` to provision the deployment.
3. Set the same URL in both env files:

   ```bash
   # myapp-web/.env.local
   NEXT_PUBLIC_CONVEX_URL=https://something-noun-123.convex.cloud
   # myapp-mobile/.env.local
   EXPO_PUBLIC_CONVEX_URL=https://something-noun-123.convex.cloud
   ```

4. Generate mobile types pointed at the shared deployment:

   ```bash
   cd myapp-mobile
   bunx convex codegen --url="$EXPO_PUBLIC_CONVEX_URL"
   ```

5. Mobile-relevant functions (`convex/r2.ts`, `convex/push.ts`) move into the web repo's `convex/`. They are regular Convex actions and the web app can call them too without harm.

In paired mode, mobile contributors never edit files under `convex/`. The only mobile-side Convex artifact is `convex/_generated/`, which is regenerated on demand.

### Codegen ordering

`bunx convex codegen` must run **before** `tsc` (or `expo prebuild`, or any type-check). The generated `api.d.ts` is what gives `useQuery(api.users.getMe)` its type — if codegen is stale, the call site falls back to a bare `FunctionReference` and downstream typing collapses.

Recommended scripts wiring:

```jsonc
// package.json (excerpt)
{
  "scripts": {
    "typecheck": "bunx convex codegen && tsc --noEmit",
    "convex:codegen": "bunx convex codegen"
  }
}
```

CI should run `convex:codegen` (or `bunx convex codegen --url=$EXPO_PUBLIC_CONVEX_URL` in paired mode) before the type-check step. In paired mode, also gitignore `convex/_generated/` and regenerate on every CI run so the mobile build always reflects the latest deployed schema.

### The `FunctionReference` cast smell

If a screen casts the `api` object to work around a typing failure, codegen is stale or hasn't been run. Fix codegen — do not cast.

```tsx
// app/(tabs)/index.tsx — current code, smell
import type { FunctionReference } from 'convex/server';

type UsersApi = {
  getMe: FunctionReference<
    'query',
    'public',
    Record<string, never>,
    MeRow | null
  >;
};

export default function HomeScreen() {
  const usersApi = api.users as unknown as UsersApi;
  const me = useQuery(usersApi.getMe);
}
```

The right fix is two-fold: add a `returns:` validator on `convex/users.ts:23` (so the generated type carries the row shape — see `convex-patterns.md`), and run `bunx convex codegen`. After that, the file becomes:

```tsx
// app/(tabs)/index.tsx — corrected
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export default function HomeScreen() {
  const me = useQuery(api.users.getMe);   // typed from server `returns:`
  /* ... */
}
```

Anti-pattern citations: `app/(tabs)/index.tsx:2` (importing `FunctionReference`), `app/(tabs)/index.tsx:9-24` (locally redeclared row + API types), `app/(tabs)/index.tsx:27` (`as unknown as UsersApi` cast).

### How to add a Convex function

The same three steps work in both modes — only the repo where step 1 happens differs.

1. Add a file under `convex/` (standalone: this codebase; paired: the web sibling). Follow `convex-patterns.md` — shorthand `args:`, explicit `returns:`, auth guard, indexed reads.
2. Run `bunx convex codegen` (in the owning repo; in paired mode add `--url=$CONVEX_URL` from the consuming repo).
3. Import on mobile from `@/convex/_generated/api`:

   ```tsx
   import { api } from '@/convex/_generated/api';
   const result = useQuery(api.posts.listByAuthor, { authorId });
   ```

Never import from `@/convex/posts` directly — that path skips the generated wrapper and breaks paired mode entirely.

## Anti-Patterns

- `app/(tabs)/index.tsx:17-24` — local `UsersApi` type that re-asserts what `returns:` on the server should provide. Indicates stale codegen or missing server-side `returns:`.
- `app/(tabs)/index.tsx:27` — `api.users as unknown as UsersApi`. Casts hide drift; never reach for one to silence a Convex type error.
- Editing `convex/users.ts` (or any feature file) in the mobile repo while in paired mode — silently diverges the type tree from the deployment.

## Decision Rationale

See `decisions.md` for:

- Why the web sibling is the default Convex owner in paired mode (broader surface, more contributors, longer-lived schemas)
- Why `convex/_generated/` is gitignored in paired mode but kept in standalone mode
- Why mobile-only functions (`r2.ts`, `push.ts`) still belong in the web repo's `convex/` when paired
