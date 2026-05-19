import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex'
import { taggedEmail } from '../tagged'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const userFields = {
  name: z.string(),
  email: z.optional(taggedEmail),  // shared codec instance — codegen identity-matches across files
  avatarUrl: z.string().optional(),
  createdAt: zx.date(),
}

export const UserModel = defineZodModel('users', userFields)
  .index('by_email', ['email.value'])
  .index('by_created', ['createdAt'])
