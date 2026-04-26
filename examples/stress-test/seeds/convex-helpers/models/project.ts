import { z } from 'zod'
import { defineTable } from 'convex/server'
import { zid, zodToConvexFields } from 'convex-helpers/server/zod4'

export const projectFields = {
  name: z.string(),
  description: z.string().optional(),
  ownerId: zid('projects'),
  active: z.boolean(),
  createdAt: z.number(),
}

export const ProjectTable = defineTable(zodToConvexFields(projectFields))
  .index('by_owner', ['ownerId'])
  .index('by_created', ['createdAt'])
