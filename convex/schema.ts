import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index('authId', ['authId']),

  pushTokens: defineTable({
    userId: v.id('users'),
    token: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android')),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_token', ['token']),
});
