# Convex — Ownership Model

This template ships with a `convex/` folder so it's runnable in isolation: clone, `bunx convex dev`, and the schema, auth bridge, R2 actions, and push actions all exist in a fresh deployment. Useful for evaluating the template, useful for a mobile-only product.

The moment you pair this template with `webapp-template` for a real product, the two apps must share **one** Convex deployment. This document is the rule for who owns it.

## Why this matters

Convex generates client types from the `convex/` source tree. Two copies of `convex/` means two sources of truth. The day someone edits `convex/users.ts` in the web repo and forgets to mirror the change to the mobile repo, the deployments diverge — and the mobile build keeps compiling against stale types until a query silently returns the wrong shape and you spend an afternoon bisecting. The drift is silent and painful.

The fix is structural: **one repo owns `convex/`, the other only consumes generated types**.

## Real-project layout

Pick the **web** app as the Convex owner unless you have a specific reason not to. Web typically has the broader surface area (admin, billing, marketing pages) and more contributors.

```
myapp-web/
  convex/                  ← source of truth
    schema.ts
    users.ts
    r2.ts
    push.ts
    _generated/
  package.json             ← runs `convex dev` / `convex deploy`

myapp-mobile/
  convex/
    _generated/            ← pulled from the web deployment, gitignored
  package.json             ← runs `convex codegen --url=$CONVEX_URL`
```

## Migration steps when spinning up a paired project

1. **In the mobile repo**, delete the full `convex/` directory:
   ```bash
   rm -rf convex/
   ```
2. **In the web repo**, run `bunx convex dev` once to provision the deployment. Note the URL it prints (`https://something-noun-123.convex.cloud`).
3. **Set the same `CONVEX_URL` in both apps' env**:
   ```bash
   # myapp-web/.env.local
   NEXT_PUBLIC_CONVEX_URL=https://something-noun-123.convex.cloud
   # myapp-mobile/.env.local
   EXPO_PUBLIC_CONVEX_URL=https://something-noun-123.convex.cloud
   ```
4. **Generate mobile types** by pointing `convex codegen` at the shared deployment:
   ```bash
   cd myapp-mobile
   bunx convex codegen --url="$EXPO_PUBLIC_CONVEX_URL"
   ```
   This writes `convex/_generated/` only. There is no `convex/schema.ts`, no `convex/users.ts` — the mobile repo never authors Convex functions.
5. **Add a sync recipe to the mobile `justfile`** so the codegen step isn't easy to forget:
   ```just
   convex-types:
       bunx convex codegen --url="$EXPO_PUBLIC_CONVEX_URL"
   ```
6. **Gitignore the generated folder** in the mobile repo:
   ```
   convex/_generated/
   ```
   (Mobile contributors regenerate; nothing in `convex/` should be committed from the mobile side.)

## Mobile-relevant functions live in the web's convex/

The mobile-specific surface (`convex/r2.ts` for presigned uploads, `convex/push.ts` for Expo Push) ships in this template's `convex/` so it's runnable standalone. In a paired project, **move those files into the web repo's `convex/`**. Web can call them too without harm — they're regular Convex actions and don't carry any mobile-specific runtime dependency.

This is the correct division: `convex/` contains the data and the server-side business logic; both apps consume it.

## What the mobile repo keeps

- `lib/r2/upload.ts` — the client-side helper that calls the R2 action and PUTs to the presigned URL.
- `lib/notifications/` — Expo push registration, channel setup, token sync.
- `lib/auth/` — WorkOS PKCE flow that produces a Convex auth token.

All of these import from `convex/_generated/api`, which is auto-generated from whatever the web repo has shipped to the shared deployment.

## What if the deployments need to diverge?

They almost never should. If you find yourself wanting a mobile-only function that the web app can't see, ask why — usually the function should live in `convex/` and the web side just doesn't call it. If you genuinely need two deployments (e.g. a separate backend for a mobile-only product spun off later), that's no longer a "paired project" — it's a fork.
