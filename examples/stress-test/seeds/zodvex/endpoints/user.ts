import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { UserModel, userFields } from '../models/user'

const byIdArgs = { id: zx.id('users') }

export const getUser = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(UserModel).nullable(),
})

export const listUsers = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('users').collect(),
  returns: zx.docArray(UserModel),
})

export const createUser = zm({
  args: { name: userFields.name, email: userFields.email, role: userFields.role },
  handler: async (ctx, args) =>
    ctx.db.insert('users', { ...args, active: true, createdAt: new Date() }),
  returns: zx.id('users'),
})

export const updateUser = zm({
  args: { id: zx.id('users'), name: userFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteUser = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
