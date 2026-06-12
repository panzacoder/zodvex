import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { documentFields } from '../models/document'

const byIdArgs = { id: v.id('documents') }

export const getDocument = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('documents'), _creationTime: v.number(), ...documentFields })),
})

export const listDocuments = query({
  args: {},
  handler: async (ctx) => ctx.db.query('documents').collect(),
  returns: v.array(v.object({ _id: v.id('documents'), _creationTime: v.number(), ...documentFields })),
})

export const createDocument = mutation({
  args: { title: documentFields.title, content: documentFields.content, authorId: documentFields.authorId },
  handler: async (ctx, args) =>
    ctx.db.insert('documents', {
      ...args,
      status: 'draft',
      tags: [],
      metadata: { wordCount: 0, version: 1 },
      isPublic: false,
      score: null,
      createdAt: Date.now(),
    }),
  returns: v.id('documents'),
})

export const updateDocument = mutation({
  args: { id: v.id('documents'), title: documentFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteDocument = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
