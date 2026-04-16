import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const documentFields = {
  title: z.string(),
  content: z.string(),
  status: z.enum(['draft', 'review', 'published', 'archived']),
  authorId: zx.id('documents'),
  tags: z.array(z.string()),
  metadata: z.object({
    wordCount: z.number(),
    version: z.number(),
    source: z.string().optional(),
  }),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  updatedAt: zx.date().optional(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const DocumentModel = defineZodModel('documents', documentFields, opts)
  .index('by_author', ['authorId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
