import { z } from 'zod'
import { defineTable } from 'convex/server'
import { zodToConvexFields } from 'convex-helpers/server/zod4'

export const taskFields = {
  title: z.string(),
  done: z.boolean(),
  priority: z.number(),
  createdAt: z.number(),
}

export const TaskTable = defineTable(zodToConvexFields(taskFields))
  .index('by_created', ['createdAt'])
