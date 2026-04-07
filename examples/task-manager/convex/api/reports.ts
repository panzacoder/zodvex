import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq } from '../functions'
import { TaskModel } from '../models/task'

/**
 * Nested function file — lives under convex/api/reports.ts.
 * Convex's getFunctionName() returns "api/reports:summary" and "api/reports:taskById".
 * zodvex codegen must emit these same paths as registry keys.
 */

export const summary = zq({
  args: {
    ownerId: zx.id('users').optional(),
  },
  handler: async (ctx, { ownerId }) => {
    const q = ownerId
      ? ctx.db.query('tasks').withIndex('by_owner', idx => idx.eq('ownerId', ownerId))
      : ctx.db.query('tasks')
    const all = await q.collect()
    return {
      total: all.length,
      done: all.filter(t => t.status === 'done').length,
    }
  },
  returns: z.object({
    total: z.number(),
    done: z.number(),
  }),
})

export const taskById = zq({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: TaskModel.schema.doc.nullable(),
})
