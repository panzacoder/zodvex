import { z } from 'zod'
import { defineTable } from 'convex/server'
import { zid, zodToConvexFields } from 'convex-helpers/server/zod4'

export const commentFields = {
  parentId: zid('comments'),
  authorId: zid('comments'),
  body: z.string(),
  createdAt: z.number(),
}

export const CommentTable = defineTable(zodToConvexFields(commentFields))
  .index('by_parent', ['parentId'])
  .index('by_created', ['createdAt'])
