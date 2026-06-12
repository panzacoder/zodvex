import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const taskFields = {
  title: v.string(),
  done: v.boolean(),
  priority: v.number(),
  createdAt: v.number(),
}

export const TaskDoc = v.object(taskFields)

export const TaskTable = defineTable(taskFields)
  .index('by_created', ['createdAt'])
