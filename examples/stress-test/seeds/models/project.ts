import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const projectFields = {
  name: z.string(),
  description: z.string().optional(),
  ownerId: zx.id('projects'),
  active: z.boolean(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const ProjectModel = defineZodModel('projects', projectFields, opts)
  .index('by_owner', ['ownerId'])
  .index('by_created', ['createdAt'])
