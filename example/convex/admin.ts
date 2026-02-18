import { z } from 'zod'
import { adminQuery } from './setup'
import { Users } from './schema'

export const listAllUsers = adminQuery({
  args: {},
  required: ['admin'],
  returns: Users.schema.docArray,
  handler: async (ctx: any) => {
    // Only reaches handler if admin role check passes (via hooks)
    return ctx.db.query('users').collect()
  },
})
