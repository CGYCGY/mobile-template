---
name: example-convex-query-pattern
description: Annotated walkthrough of a Convex query+mutation pair (users.getMe / completeOnboarding) and the mobile call site.
---

# Example: Convex Query + Mutation Pair

This example shows the canonical Convex function shape (`args` shorthand, `returns` validator, auth guard, indexed lookup) and the mobile call site.

## Backend (Convex)

```ts
// convex/users.ts (recommended shape — current file uses v.object args; should normalize to shorthand)
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const getMe = query({
  args: {},
  // ⚠️ returns validator REQUIRED — see decisions.md → "Convex returns: validators"
  returns: v.union(
    v.object({
      _id: v.id('users'),
      authId: v.string(),
      email: v.string(),
      name: v.string(),
      displayName: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // ✓ withIndex, not filter — see decisions.md → "Convex args: style" + schema indexes
    const row = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', identity.subject))
      .unique();
    return row;
  },
});

export const completeOnboarding = mutation({
  // ✓ Shorthand args form
  args: { displayName: v.string(), bio: v.optional(v.string()) },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, { displayName, bio }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError('unauthenticated');

    const row = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', identity.subject))
      .unique();
    if (!row) throw new ConvexError('user not found');

    await ctx.db.patch(row._id, { displayName, bio });
    return { ok: true } as const;
  },
});
```

## Schema (indexes belong here)

```ts
// convex/schema.ts (excerpt)
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
  }).index('by_authId', ['authId']),  // ✓ index used by withIndex above
});
```

## Mobile call site

```tsx
// app/(tabs)/index.tsx (recommended — current file uses a FunctionReference cast workaround;
// run `bunx convex codegen` to get rid of the cast. See decisions.md → "Convex codegen ordering")
import { useQuery } from 'convex/react';
import { Spinner, YStack, Paragraph } from 'tamagui';
import { api } from '@/convex/_generated/api';

export default function HomeScreen() {
  const me = useQuery(api.users.getMe);

  if (me === undefined) return <Spinner />;
  if (me === null) return <Paragraph>Profile not yet synced.</Paragraph>;
  return <Paragraph>{me.displayName ?? me.name}</Paragraph>;
}
```

```tsx
// Mutation call site
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

const completeOnboarding = useMutation(api.users.completeOnboarding);
await completeOnboarding({ displayName: 'Ada Lovelace' });
```

## Patterns demonstrated

- ✓ **Shorthand `args`** — `{ displayName: v.string() }` not `v.object({...})`.
- ✓ **`returns` validator** declared. Without it, the wire shape drifts silently on handler refactors.
- ✓ **Auth guard** at top of every function that needs the caller.
- ✓ **`withIndex` over `filter`** — equality lookups must use a defined index.
- ✓ **`v.id('users')` for FKs** — never `v.string()`.
- ✓ **Mobile imports from `@/convex/_generated/api`** — never from `convex/users.ts`.
- ✓ **`useQuery` triple-state** — `undefined` (loading) / `null` (no row) / data.

## Anti-patterns

- ❌ `as FunctionReference<'query', ...>` casts (currently in `app/(tabs)/index.tsx:17-23`) — the cast says "I know better than codegen". Run `bunx convex codegen` instead. See `decisions.md` → "Convex codegen ordering".
- ❌ `args: v.object({...})` outer wrapper (currently in `convex/users.ts`) — normalize to shorthand.
- ❌ Missing `returns:` validator (currently every public function in `convex/`) — add one per function.
- ❌ `.filter((q) => q.eq(...))` for equality. Use `withIndex` and define the index in `schema.ts`.
