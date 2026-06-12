import { z } from 'zod/v3'
import { defineTable } from 'convex/server'
import { zid, zodToConvexFields } from 'convex-helpers/server/zod3'

export const commentFields = {
  parentId: zid('comments'),
  authorId: zid('comments'),
  body: z.string(),
  createdAt: z.number(),
}

export const CommentTable = defineTable(zodToConvexFields(commentFields))
  .index('by_parent', ['parentId'])
  .index('by_created', ['createdAt'])
