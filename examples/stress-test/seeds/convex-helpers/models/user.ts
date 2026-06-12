import { z } from 'zod'
import { defineTable } from 'convex/server'
import { zodToConvexFields } from 'convex-helpers/server/zod4'

export const userFields = {
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  role: z.enum(['admin', 'member', 'viewer']),
  settings: z.object({
    theme: z.enum(['light', 'dark']),
    notifications: z.boolean(),
  }).optional(),
  lastLoginAt: z.number().optional(),
  active: z.boolean(),
  createdAt: z.number(),
}

export const UserTable = defineTable(zodToConvexFields(userFields))
  .index('by_email', ['email'])
  .index('by_role', ['role'])
  .index('by_created', ['createdAt'])
