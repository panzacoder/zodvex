import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const projectFields = {
  name: v.string(),
  description: v.optional(v.string()),
  ownerId: v.id('projects'),
  active: v.boolean(),
  createdAt: v.number(),
}

export const ProjectDoc = v.object(projectFields)

export const ProjectTable = defineTable(projectFields)
  .index('by_owner', ['ownerId'])
  .index('by_created', ['createdAt'])
