import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'
import { tagged } from '../tagged'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const userFields = {
  name: z.string(),
  email: z.optional(tagged(z.string())),  // factory-created codec — new instance per call
  avatarUrl: z.string().optional(),
  createdAt: zx.date(),
}

export const UserModel = defineZodModel('users', userFields)
  .index('by_email', ['email.value'])
  .index('by_created', ['createdAt'])
