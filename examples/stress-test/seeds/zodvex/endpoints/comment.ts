import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { CommentModel, commentFields } from '../models/comment'

const byIdArgs = { id: zx.id('comments') }

export const getComment = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(CommentModel).nullable(),
})

export const listComments = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('comments').collect(),
  returns: zx.docArray(CommentModel),
})

export const createComment = zm({
  args: { parentId: commentFields.parentId, authorId: commentFields.authorId, body: commentFields.body },
  handler: async (ctx, args) =>
    ctx.db.insert('comments', { ...args, createdAt: new Date() }),
  returns: zx.id('comments'),
})

export const updateComment = zm({
  args: { id: zx.id('comments'), body: commentFields.body },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteComment = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
