import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const documentFields = {
  title: v.string(),
  content: v.string(),
  status: v.union(
    v.literal('draft'),
    v.literal('review'),
    v.literal('published'),
    v.literal('archived')
  ),
  authorId: v.id('documents'),
  tags: v.array(v.string()),
  metadata: v.object({
    wordCount: v.number(),
    version: v.number(),
    source: v.optional(v.string()),
  }),
  isPublic: v.boolean(),
  score: v.union(v.number(), v.null()),
  updatedAt: v.optional(v.number()),
  createdAt: v.number(),
}

export const DocumentDoc = v.object(documentFields)

export const DocumentTable = defineTable(documentFields)
  .index('by_author', ['authorId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
