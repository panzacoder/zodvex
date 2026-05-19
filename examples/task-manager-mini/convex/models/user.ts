import { z } from 'zod/mini'
import { zx, defineZodModel } from 'zodvex/mini'
import { taggedEmail } from '../tagged'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const userFields = {
  name: z.string(),
  email: z.optional(taggedEmail),  // shared codec instance — codegen identity-matches across files
  avatarUrl: z.optional(z.string()),
  createdAt: zx.date(),
}

export const UserModel = defineZodModel('users', userFields)
  .index('by_email', ['email.value'])
  .index('by_created', ['createdAt'])
