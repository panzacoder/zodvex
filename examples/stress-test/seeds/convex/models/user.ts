import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const userFields = {
  name: v.string(),
  email: v.string(),
  avatarUrl: v.optional(v.string()),
  role: v.union(v.literal('admin'), v.literal('member'), v.literal('viewer')),
  settings: v.optional(
    v.object({
      theme: v.union(v.literal('light'), v.literal('dark')),
      notifications: v.boolean(),
    })
  ),
  lastLoginAt: v.optional(v.number()),
  active: v.boolean(),
  createdAt: v.number(),
}

export const UserDoc = v.object(userFields)

export const UserTable = defineTable(userFields)
  .index('by_email', ['email'])
  .index('by_role', ['role'])
  .index('by_created', ['createdAt'])
