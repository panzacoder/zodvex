import { z } from 'zod/v3'
import { defineTable } from 'convex/server'
import { zid, zodToConvexFields } from 'convex-helpers/server/zod3'

export const documentFields = {
  title: z.string(),
  content: z.string(),
  status: z.enum(['draft', 'review', 'published', 'archived']),
  authorId: zid('documents'),
  tags: z.array(z.string()),
  metadata: z.object({
    wordCount: z.number(),
    version: z.number(),
    source: z.string().optional(),
  }),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  updatedAt: z.number().optional(),
  createdAt: z.number(),
}

export const DocumentTable = defineTable(zodToConvexFields(documentFields))
  .index('by_author', ['authorId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
