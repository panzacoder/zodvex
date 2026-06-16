import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { userFields } from '../models/user'

const byIdArgs = { id: v.id('users') }

export const getUser = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('users'), _creationTime: v.number(), ...userFields })),
})

export const listUsers = query({
  args: {},
  handler: async (ctx) => ctx.db.query('users').collect(),
  returns: v.array(v.object({ _id: v.id('users'), _creationTime: v.number(), ...userFields })),
})

export const createUser = mutation({
  args: { name: userFields.name, email: userFields.email, role: userFields.role },
  handler: async (ctx, args) =>
    ctx.db.insert('users', { ...args, active: true, createdAt: Date.now() }),
  returns: v.id('users'),
})

export const updateUser = mutation({
  args: { id: v.id('users'), name: userFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteUser = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
