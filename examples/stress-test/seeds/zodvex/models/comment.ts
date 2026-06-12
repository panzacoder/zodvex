import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const commentFields = {
  parentId: zx.id('comments'),
  authorId: zx.id('comments'),
  body: z.string(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const CommentModel = defineZodModel('comments', commentFields, opts)
  .index('by_parent', ['parentId'])
  .index('by_created', ['createdAt'])
