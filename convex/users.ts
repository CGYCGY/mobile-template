import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { profileFormSchema } from './schemas/profile';

// Diagnostic: throws when the WorkOS→Convex JWT bridge is broken so the
// dashboard can distinguish "bridge broken" from "webhook not yet fired."
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        'No Convex identity — JWT bridge is broken or user is not signed in.',
      );
    }
    return {
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier,
    };
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', identity.subject))
      .unique();
  },
});

export const getByAuthId = query({
  args: { authId: v.string() },
  handler: async (ctx, { authId }) => {
    return ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', authId))
      .unique();
  },
});

export const completeOnboarding = mutation({
  args: v.object({
    displayName: v.string(),
    bio: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }
    const parsed = profileFormSchema.parse(args);
    const existing = await ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', identity.subject))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: parsed.displayName,
        bio: parsed.bio,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return ctx.db.insert('users', {
      authId: identity.subject,
      email: identity.email ?? '',
      name: identity.name ?? '',
      displayName: parsed.displayName,
      bio: parsed.bio,
      updatedAt: Date.now(),
    });
  },
});

export const updateProfile = mutation({
  args: v.object({
    displayName: v.string(),
    bio: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }
    const parsed = profileFormSchema.parse(args);
    const user = await ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', identity.subject))
      .unique();
    if (!user) {
      throw new Error(
        'User row not found — WorkOS webhook has not synced this user yet.',
      );
    }
    // Skip patch when nothing changed: avoids a write and the subscription
    // invalidation it triggers across every getMe subscriber.
    if (
      user.displayName === parsed.displayName &&
      (user.bio ?? '') === (parsed.bio ?? '')
    ) {
      return user._id;
    }
    await ctx.db.patch(user._id, {
      displayName: parsed.displayName,
      bio: parsed.bio,
      updatedAt: Date.now(),
    });
    return user._id;
  },
});
