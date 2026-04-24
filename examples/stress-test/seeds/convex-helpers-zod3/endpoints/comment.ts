import { z } from 'zod/v3'
import { zid } from 'convex-helpers/server/zod3'
import { zQuery, zMutation } from '../functions'
import { commentFields } from '../models/comment'

const byIdArgs = { id: zid('comments') }
const commentDoc = z.object({ _id: zid('comments'), _creationTime: z.number(), ...commentFields })

export const getComment = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: commentDoc.nullable(),
})

export const listComments = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('comments').collect(),
  returns: z.array(commentDoc),
})

export const createComment = zMutation({
  args: { parentId: commentFields.parentId, authorId: commentFields.authorId, body: commentFields.body },
  handler: async (ctx, args) =>
    ctx.db.insert('comments', { ...args, createdAt: Date.now() }),
  returns: zid('comments'),
})

export const updateComment = zMutation({
  args: { id: zid('comments'), body: commentFields.body },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteComment = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
