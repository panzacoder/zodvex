import { z } from 'zod/mini'
import { zx, defineZodModel } from 'zodvex/mini'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const commentFields = {
  taskId: zx.id('tasks'),
  authorId: zx.id('users'),
  body: z.string(),
  createdAt: zx.date(),
}

export const CommentModel = defineZodModel('comments', commentFields)
  .index('by_task', ['taskId'])
