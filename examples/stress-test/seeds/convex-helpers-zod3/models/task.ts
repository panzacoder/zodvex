import { z } from 'zod/v3'
import { defineTable } from 'convex/server'
import { zodToConvexFields } from 'convex-helpers/server/zod3'

export const taskFields = {
  title: z.string(),
  done: z.boolean(),
  priority: z.number(),
  createdAt: z.number(),
}

export const TaskTable = defineTable(zodToConvexFields(taskFields))
  .index('by_created', ['createdAt'])
