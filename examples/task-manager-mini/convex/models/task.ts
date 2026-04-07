import { z } from 'zod/mini'
import { zx, defineZodModel } from 'zodvex/mini'
import { zDuration } from '../codecs'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const taskFields = {
  title: z.string(),
  description: z.optional(z.string()),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.nullable(z.enum(['low', 'medium', 'high'])),
  ownerId: zx.id('users'),
  assigneeId: z.optional(zx.id('users')),
  dueDate: z.optional(zx.date()),
  completedAt: z.optional(zx.date()),
  estimate: z.optional(zDuration),
  createdAt: zx.date(),
}

export const TaskModel = defineZodModel('tasks', taskFields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_assignee', ['assigneeId'])
  .index('by_created', ['createdAt'])
  .index('by_completed', ['completedAt'])
