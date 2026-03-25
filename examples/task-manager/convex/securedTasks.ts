/**
 * Demonstrates .withRules() usage on ZodvexDatabaseReader/Writer.
 * Validates that the lazy `import('./rules')` pattern in db.ts resolves
 * correctly in the built bundle — this was the tree-shaking bug in beta.51.
 */
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { TaskModel } from './models/task'

/**
 * Query that applies read rules to filter tasks by ownership.
 * Uses .withRules() on the ZodvexDatabaseReader.
 */
export const listOwnTasks = zq({
  args: { ownerId: zx.id('users') },
  handler: async (ctx, { ownerId }) => {
    // Apply row-level security: only return tasks owned by the requesting user
    const secureDb = ctx.db.withRules(
      { ownerId },
      {
        tasks: {
          read: async (ruleCtx: { ownerId: string }, doc: any) => {
            // Only allow reading tasks that belong to the requesting user
            return doc.assigneeId === ruleCtx.ownerId ? doc : null
          },
        },
      }
    )
    return await secureDb
      .query('tasks')
      .collect()
  },
  returns: z.array(TaskModel.schema.doc),
})

/**
 * Mutation that applies write rules to enforce ownership on updates.
 * Uses .withRules() on the ZodvexDatabaseWriter.
 */
export const updateOwnTask = zm({
  args: {
    taskId: zx.id('tasks'),
    title: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    actorId: zx.id('users'),
  },
  handler: async (ctx, { taskId, title, status, actorId }) => {
    // Apply write rules: only allow updating own tasks
    const secureDb = ctx.db.withRules(
      { actorId },
      {
        tasks: {
          write: async (ruleCtx: { actorId: string }, doc: any) => {
            if (doc.assigneeId !== ruleCtx.actorId) {
              throw new Error('Cannot update tasks you do not own')
            }
            return doc
          },
        },
      }
    )

    const updates: Record<string, any> = {}
    if (title !== undefined) updates.title = title
    if (status !== undefined) updates.status = status

    await secureDb.patch(taskId, updates)
  },
})
