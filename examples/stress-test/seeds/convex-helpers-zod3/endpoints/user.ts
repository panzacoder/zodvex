import { z } from 'zod/v3'
import { zid } from 'convex-helpers/server/zod3'
import { zQuery, zMutation } from '../functions'
import { userFields } from '../models/user'

const byIdArgs = { id: zid('users') }
const userDoc = z.object({ _id: zid('users'), _creationTime: z.number(), ...userFields })

export const getUser = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: userDoc.nullable(),
})

export const listUsers = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('users').collect(),
  returns: z.array(userDoc),
})

export const createUser = zMutation({
  args: { name: userFields.name, email: userFields.email, role: userFields.role },
  handler: async (ctx, args) =>
    ctx.db.insert('users', { ...args, active: true, createdAt: Date.now() }),
  returns: zid('users'),
})

export const updateUser = zMutation({
  args: { id: zid('users'), name: userFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteUser = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
