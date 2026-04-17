import { z } from 'zod/mini'
import { zx, defineZodModel } from 'zodvex/mini'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const commentFields = {
  taskId: zx.id('tasks'),
  authorId: zx.id('users'),
  body: z.string(),
  createdAt: zx.date(),
}

// Slim model (schemaHelpers: false) — no pre-built schema bundle on the model.
// Endpoints derive doc/base/update/docArray on demand via cached zx.* helpers.
// Mirrors the slim flip in examples/task-manager for mini-build coverage.
export const CommentModel = defineZodModel('comments', commentFields, { schemaHelpers: false })
  .index('by_task', ['taskId'])
  .index('by_created', ['createdAt'])
