import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalQuery, mutation } from './_generated/server';

const platform = v.union(v.literal('ios'), v.literal('android'));

export const registerExpoPushToken = mutation({
  args: {
    token: v.string(),
    platform,
  },
  handler: async (ctx, { token, platform: tokenPlatform }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    const user = await ctx.db
      .query('users')
      .withIndex('authId', (q) => q.eq('authId', identity.subject))
      .unique();
    if (!user) {
      throw new Error(
        'User row not found — WorkOS webhook has not synced this user yet.',
      );
    }

    const existing = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();

    if (existing) {
      if (
        existing.userId !== user._id ||
        existing.platform !== tokenPlatform
      ) {
        await ctx.db.patch(existing._id, {
          userId: user._id,
          platform: tokenPlatform,
        });
      }
      return existing._id;
    }

    return ctx.db.insert('pushTokens', {
      userId: user._id,
      token,
      platform: tokenPlatform,
      createdAt: Date.now(),
    });
  },
});

export const removeExpoPushToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    const row = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row._id;
  },
});

export const tokensForUser = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query('pushTokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
  },
});

export const sendPushToUser = action({
  args: {
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, { userId, title, body, data }) => {
    const tokens = await ctx.runQuery(internal.push.tokensForUser, { userId });
    if (tokens.length === 0) return { sent: 0 };

    const messages = tokens.map((row) => ({
      to: row.token,
      title,
      body,
      data,
      sound: 'default' as const,
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      throw new Error(`Expo push send failed: ${res.status} ${res.statusText}`);
    }

    return { sent: messages.length };
  },
});
