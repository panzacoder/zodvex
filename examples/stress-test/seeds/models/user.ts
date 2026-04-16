import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const userFields = {
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  role: z.enum(['admin', 'member', 'viewer']),
  settings: z.object({
    theme: z.enum(['light', 'dark']),
    notifications: z.boolean(),
  }).optional(),
  lastLoginAt: zx.date().optional(),
  active: z.boolean(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const UserModel = defineZodModel('users', userFields, opts)
  .index('by_email', ['email'])
  .index('by_role', ['role'])
  .index('by_created', ['createdAt'])
