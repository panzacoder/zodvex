import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const commentFields = {
  taskId: zx.id('tasks'),
  authorId: zx.id('users'),
  body: z.string(),
  createdAt: zx.date(),
}

export const CommentModel = defineZodModel('comments', commentFields)
  .index('by_task', ['taskId'])
