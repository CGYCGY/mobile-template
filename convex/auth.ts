import { type AuthFunctions, AuthKit } from '@convex-dev/workos-authkit';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';

const authFunctions: AuthFunctions = internal.auth;

const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
});

export { authKit };

export const { authKitEvent } = authKit.events({
  'user.created': async (ctx, event) => {
    await ctx.db.insert('users', {
      authId: event.data.id,
      email: event.data.email,
      name: `${event.data.firstName ?? ''} ${event.data.lastName ?? ''}`.trim(),
    });
  },
  'user.updated': async (ctx, event) => {
    const user = await ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', event.data.id))
      .unique();
    if (!user) {
      console.warn(`User not found for update: ${event.data.id}`);
      return;
    }
    const name =
      `${event.data.firstName ?? ''} ${event.data.lastName ?? ''}`.trim();
    // WorkOS can fire user.updated on every session refresh; skip the patch
    // when nothing changed so we don't invalidate every getMe subscriber.
    if (user.email === event.data.email && user.name === name) {
      return;
    }
    await ctx.db.patch(user._id, { email: event.data.email, name });
  },
  'user.deleted': async (ctx, event) => {
    const user = await ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', event.data.id))
      .unique();
    if (!user) {
      console.warn(`User not found for delete: ${event.data.id}`);
      return;
    }
    await ctx.db.delete(user._id);
  },
});
