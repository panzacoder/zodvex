import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const taskFields = {
  title: z.string(),
  done: z.boolean(),
  priority: z.number(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const TaskModel = defineZodModel('tasks', taskFields, opts)
  .index('by_created', ['createdAt'])
