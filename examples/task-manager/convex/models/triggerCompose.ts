import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex'

/**
 * Tables maintained by convex-helpers triggers composed UNDER the zodvex
 * codec layer (zodvex#92) — see ../triggersCompose.ts.
 *
 * Both tables are written from inside trigger functions via the raw
 * `ctx.innerDb`, so their fields are deliberately codec-free (native wire
 * shapes only).
 */

/** One row per observed change on `tasks` — records what the trigger saw. */
export const triggerLogFields = {
  taskId: zx.id('tasks'),
  operation: z.enum(['insert', 'update', 'delete']),
  // Raw dueDate value as observed by the trigger. Pins encode ordering:
  // the codec layer encodes zx.date() → number BEFORE the trigger layer
  // sees the write, so this must always be a number (or null when unset).
  wireDueDate: z.number().nullable(),
  wireDueDateType: z.string(),
  // Plain number (not zx.date()) — trigger functions write raw wire values.
  // Every table carries by_created so cleanup.ts's dynamic-table query works.
  createdAt: z.number(),
}

export const TriggerLogModel = defineZodModel('triggerLog', triggerLogFields)
  .index('by_task', ['taskId'])
  .index('by_created', ['createdAt'])

/** Aggregate-style per-owner task count, maintained by the trigger. */
export const taskCountFields = {
  ownerId: zx.id('users'),
  count: z.number(),
  createdAt: z.number(),
}

export const TaskCountModel = defineZodModel('taskCounts', taskCountFields)
  .index('by_owner', ['ownerId'])
  .index('by_created', ['createdAt'])
