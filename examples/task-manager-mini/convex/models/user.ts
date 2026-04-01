import { z } from 'zod/mini'
import { zx, defineZodModel } from 'zodvex/mini'
import { tagged } from '../tagged'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const userFields = {
  name: z.string(),
  email: z.optional(tagged(z.string())),  // factory-created codec — new instance per call
  avatarUrl: z.optional(z.string()),
  createdAt: zx.date(),
}

export const UserModel = defineZodModel('users', userFields)
  .index('by_email', ['email.value'])
