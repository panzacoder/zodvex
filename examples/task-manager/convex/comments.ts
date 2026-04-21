import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from './functions'
import { CommentModel } from './models/comment'

export const list = zq({
  args: { taskId: zx.id('tasks') },
  handler: async (ctx, { taskId }) => {
    return await ctx.db
      .query('comments')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .order('desc')
      .collect()
  },
  returns: zx.docArray(CommentModel),
})

export const create = zm({
  args: {
    taskId: zx.id('tasks'),
    authorId: zx.id('users'),
    body: z.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('comments', {
      ...args,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('comments'),
})
