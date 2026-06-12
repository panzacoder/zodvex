import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { DocumentModel, documentFields } from '../models/document'

const byIdArgs = { id: zx.id('documents') }

export const getDocument = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(DocumentModel).nullable(),
})

export const listDocuments = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('documents').collect(),
  returns: zx.docArray(DocumentModel),
})

export const createDocument = zm({
  args: { title: documentFields.title, content: documentFields.content, authorId: documentFields.authorId },
  handler: async (ctx, args) =>
    ctx.db.insert('documents', { ...args, status: 'draft', tags: [], metadata: { wordCount: 0, version: 1 }, isPublic: false, score: null, createdAt: new Date() }),
  returns: zx.id('documents'),
})

export const updateDocument = zm({
  args: { id: zx.id('documents'), title: documentFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteDocument = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
