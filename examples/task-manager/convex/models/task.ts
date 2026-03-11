import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'
import { zDuration } from '../codecs'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const taskFields = {
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  ownerId: zx.id('users'),
  assigneeId: zx.id('users').optional(),
  dueDate: zx.date().optional(),
  completedAt: zx.date().optional(),
  estimate: zDuration.optional(),
  createdAt: zx.date(),
}

export const TaskModel = defineZodModel('tasks', taskFields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_assignee', ['assigneeId'])
  .index('by_created', ['createdAt'])
