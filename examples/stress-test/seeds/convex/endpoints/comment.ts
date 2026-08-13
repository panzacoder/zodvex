import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { commentFields } from '../models/comment'

const byIdArgs = { id: v.id('comments') }

export const getComment = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('comments'), _creationTime: v.number(), ...commentFields })),
})

export const listComments = query({
  args: {},
  handler: async (ctx) => ctx.db.query('comments').collect(),
  returns: v.array(v.object({ _id: v.id('comments'), _creationTime: v.number(), ...commentFields })),
})

export const createComment = mutation({
  args: { parentId: commentFields.parentId, authorId: commentFields.authorId, body: commentFields.body },
  handler: async (ctx, args) =>
    ctx.db.insert('comments', { ...args, createdAt: Date.now() }),
  returns: v.id('comments'),
})

export const updateComment = mutation({
  args: { id: v.id('comments'), body: commentFields.body },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteComment = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
