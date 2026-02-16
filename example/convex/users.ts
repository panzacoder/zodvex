import { z } from 'zod'
import { authQuery, authMutation } from './setup'
import { Users } from './schema'
import { stateCode } from './stateCode'

export const get = authQuery({
  args: { userId: z.string() },
  returns: Users.schema.doc.nullable(),
  handler: async (ctx: any, { userId }: any) => {
    return ctx.db.get(userId)
  },
})

export const list = authQuery({
  args: {},
  returns: Users.schema.docArray,
  handler: async (ctx: any) => {
    return ctx.db.query('users').collect()
  },
})

export const create = authMutation({
  args: {
    name: z.string(),
    email: z.string(),
    state: stateCode(),
  },
  handler: async (ctx: any, args: any) => {
    // args.state is runtime format ("California")
    // DB wrapper encodes to wire format ("CA") on insert
    return ctx.db.insert('users', args)
  },
})
