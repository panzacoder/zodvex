import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const commentFields = {
  parentId: v.id('comments'),
  authorId: v.id('comments'),
  body: v.string(),
  createdAt: v.number(),
}

export const CommentDoc = v.object(commentFields)

export const CommentTable = defineTable(commentFields)
  .index('by_parent', ['parentId'])
  .index('by_created', ['createdAt'])
