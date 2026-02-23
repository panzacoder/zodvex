import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { UserModel } from './models/user'

export const get = zq({
  args: { id: zx.id('users') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: UserModel.schema.doc.nullable(),
})

export const getByEmail = zq({
  args: { email: z.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()
  },
  returns: UserModel.schema.doc.nullable(),
})

export const create = zm({
  args: {
    name: z.string(),
    email: z.string(),
    avatarUrl: z.string().optional(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('users', {
      ...args,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('users'),
})

export const update = zm({
  args: {
    id: zx.id('users'),
    name: z.string().optional(),
    email: z.string().optional(),
    avatarUrl: z.string().optional(),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  },
})
