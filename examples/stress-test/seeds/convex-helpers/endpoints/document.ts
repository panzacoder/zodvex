import { z } from 'zod'
import { zid } from 'convex-helpers/server/zod4'
import { zQuery, zMutation } from '../functions'
import { documentFields } from '../models/document'

const byIdArgs = { id: zid('documents') }
const documentDoc = z.object({ _id: zid('documents'), _creationTime: z.number(), ...documentFields })

export const getDocument = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: documentDoc.nullable(),
})

export const listDocuments = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('documents').collect(),
  returns: z.array(documentDoc),
})

export const createDocument = zMutation({
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
  returns: zid('documents'),
})

export const updateDocument = zMutation({
  args: { id: zid('documents'), title: documentFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteDocument = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
