import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const userFields = {
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  createdAt: zx.date(),
}

export const UserModel = defineZodModel('users', userFields)
  .index('by_email', ['email'])
