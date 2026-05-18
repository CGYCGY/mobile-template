---
name: convex-patterns
description: Day-to-day rules for authoring Convex functions in this codebase — file layout, function kinds, validators, indexes, auth guards, and mobile consumption.
---

# Convex Patterns

## Purpose

Convex is the backend contract for this codebase. Every public function is a typed RPC, every reactive screen subscribes through `useQuery`, and every write goes through a `mutation`. Getting these patterns right is what keeps the mobile and backend in sync without manual API plumbing — get them wrong and you lose type safety, leak full table scans, or break the auth boundary silently.

This doc is the rulebook for code that lives under `convex/`. For the question of *which repo owns* `convex/`, see `convex-paired-mode.md`.

## Patterns

### File layout

One file per feature/domain. System files have fixed names; per-feature schema fragments live under `convex/schemas/` and are composed by `schema.ts`.

```
convex/
  schema.ts            // defineSchema — composes all tables and indexes
  auth.config.ts       // provider config consumed by Convex itself
  auth.ts              // server-side auth glue (webhook handlers, AuthKit wiring)
  http.ts              // httpRouter — webhooks and raw HTTP
  convex.config.ts     // defineApp — components like @convex-dev/workos-authkit
  users.ts             // feature module — public query/mutation
  push.ts              // feature module — registration mutations + send action
  r2.ts                // feature module — presigned URL actions
  schemas/
    profile.ts         // Zod schema shared between client form + server validation
  _generated/          // auto-generated — never edit
```

New feature `posts`? Add `convex/posts.ts` (functions) and, if its row shape is non-trivial, `convex/schemas/post.ts` (Zod fragment imported by both `convex/posts.ts` handlers and the client form).

### Function kind decision matrix

| You are doing                                | Use         | Example                                                      |
|----------------------------------------------|-------------|--------------------------------------------------------------|
| Reading from `ctx.db`                        | `query`     | `getMe` in `convex/users.ts:23`                              |
| Writing to `ctx.db` (transactional, no I/O)  | `mutation`  | `completeOnboarding` in `convex/users.ts:45`                 |
| External I/O — fetch, AWS SDK, push services | `action`    | `sendPushToUser` in `convex/push.ts:85`, `generatePresignedPutUrl` in `convex/r2.ts:29` |
| Helper callable only from other Convex fns   | `internal*` | `tokensForUser` (`internalQuery`) in `convex/push.ts:75`     |

Rule: actions never touch `ctx.db` directly — they call `ctx.runQuery` / `ctx.runMutation`. See `convex/push.ts:93` where `sendPushToUser` calls `internal.push.tokensForUser` before fetching Expo's API.

### `args:` — shorthand form only

Use the object shorthand. The function builder accepts a record of validators directly.

```ts
// convex/push.ts
export const registerExpoPushToken = mutation({
  args: {
    token: v.string(),
    platform,
  },
  handler: async (ctx, { token, platform: tokenPlatform }) => { /* ... */ },
});
```

The canonical example is `convex/push.ts:7`. Do not wrap the args record in `v.object({...})` — it works but is inconsistent with the rest of the codebase and adds a redundant layer.

Anti-pattern in the current tree: `convex/users.ts:46` and `convex/users.ts:80` use `args: v.object({...})`. Normalize to the shorthand:

```ts
// convex/users.ts — fix
export const completeOnboarding = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => { /* ... */ },
});
```

### `returns:` validators — required on every public function

A `returns:` validator catches schema drift at the API boundary. Without it, a handler that quietly starts returning an extra field, or a renamed column, will silently flow to the client and break a typed screen far from the source.

```ts
// convex/users.ts — getMe with explicit returns
export const getMe = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('users'),
      _creationTime: v.number(),
      authId: v.string(),
      email: v.string(),
      name: v.string(),
      displayName: v.optional(v.string()),
      bio: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => { /* unchanged */ },
});
```

Current state — none of the public functions in this codebase declare `returns:`. Files that need `returns:` added:

- `convex/users.ts` — `whoami` (7), `getMe` (23), `getByAuthId` (35), `completeOnboarding` (45), `updateProfile` (79)
- `convex/push.ts` — `registerExpoPushToken` (7), `removeExpoPushToken` (55), `sendPushToUser` (85)
- `convex/r2.ts` — `generatePresignedPutUrl` (29), `generatePresignedGetUrl` (53)

`internalQuery` / `internalMutation` / `internalAction` may omit `returns:` since their callers are inside the type-checked Convex tree, but it's still good hygiene.

### Indexes — define in schema, use `.withIndex`

Every equality lookup must hit an index. Define the index in `convex/schema.ts` and read with `.withIndex(...)`. Never use `.filter(q => q.eq(...))` for equality — it scans every row.

```ts
// convex/schema.ts
users: defineTable({
  authId: v.string(),
  /* ... */
}).index('authId', ['authId']),

pushTokens: defineTable({
  userId: v.id('users'),
  token: v.string(),
  /* ... */
})
  .index('by_user', ['userId'])
  .index('by_token', ['token']),
```

```ts
// convex/users.ts
return ctx.db
  .query('users')
  .withIndex('authId', (q) => q.eq('authId', identity.subject))
  .unique();
```

See `convex/users.ts:30`, `convex/push.ts:20`, `convex/push.ts:30`, `convex/push.ts:79` for canonical usage. Naming convention in this codebase is mixed (`authId`, `by_user`, `by_token`) — prefer `by_<field>` for new indexes.

### Auth guard

Every public function that needs the caller must call `ctx.auth.getUserIdentity()` and throw on null. Throwing `ConvexError` is preferred (clients can detect it as a typed error) but the existing tree uses plain `Error` — either is acceptable, just be consistent within a feature.

```ts
// convex/users.ts:51
const identity = await ctx.auth.getUserIdentity();
if (!identity) {
  throw new Error('Not authenticated');
}
```

Queries that should degrade gracefully (e.g. the home screen pre-onboarding) may return `null` instead of throwing — `getMe` in `convex/users.ts:26` does exactly this.

### Foreign keys — `v.id("users")`, not `v.string()`

```ts
// convex/schema.ts
pushTokens: defineTable({
  userId: v.id('users'),   // typed reference
  /* ... */
})
```

`v.id('users')` gives the function arg type `Id<'users'>` and lets `ctx.db.get(userId)` infer the row shape. `v.string()` loses both. See `convex/schema.ts:15` for the canonical case and `convex/push.ts:76` for the action arg.

### Mobile usage

Mobile code imports **only** from `@/convex/_generated/api`. Never reach into `@/convex/users` or any feature file directly — the generated `api` object is what gives `useQuery` / `useMutation` their type bindings.

```tsx
// app/(tabs)/index.tsx — corrected shape
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export default function HomeScreen() {
  const me = useQuery(api.users.getMe);
  // me is typed from the server `returns:` validator
}
```

For mutations:

```tsx
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

const complete = useMutation(api.users.completeOnboarding);
await complete({ displayName: 'Ada', bio: 'hi' });
```

Conditional fetch — pass `'skip'`, never wrap the hook in a conditional:

```tsx
const me = useQuery(api.users.getMe, isSignedIn ? {} : 'skip');
```

## Anti-Patterns

- `convex/users.ts:46`, `convex/users.ts:80` — `args: v.object({...})` instead of shorthand. Normalize.
- `convex/users.ts:23`, `convex/users.ts:35`, `convex/users.ts:45`, `convex/users.ts:79`, `convex/push.ts:7`, `convex/push.ts:55`, `convex/push.ts:85`, `convex/r2.ts:29`, `convex/r2.ts:53` — missing `returns:` validator.
- `app/(tabs)/index.tsx:17` — `FunctionReference` cast on `api.users`. Symptom of stale codegen, not a fix. See `convex-paired-mode.md`.

## Decision Rationale

See `decisions.md` for:

- Why `returns:` is non-negotiable on public functions even though Convex doesn't enforce it
- Why `.filter()` is forbidden for equality lookups (full table scan, no reactive index reuse)
- Why mobile imports route through `_generated/api` rather than feature files directly
