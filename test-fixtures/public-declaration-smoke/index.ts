import { z } from 'zod'
import { z as zm } from 'zod/mini'
import { defineZodModel, zx } from 'zodvex'
import { defineZodModel as defineMiniZodModel, zx as zxm } from 'zodvex/mini'
import { defineZodSchema, initZodvex } from 'zodvex/server'
import { defineZodSchema as defineMiniZodSchema, initZodvex as initMiniZodvex } from 'zodvex/mini/server'

declare const query: any
declare const mutation: any
declare const action: any
declare const internalQuery: any
declare const internalMutation: any
declare const internalAction: any

export const FullUserModel = defineZodModel('users', {
  email: z.string(),
  createdAt: zx.date()
}).index('by_email', ['email'])

export const FullSchema = defineZodSchema({
  users: FullUserModel
})

export const FullApi = initZodvex(FullSchema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction
})

export const MiniUserModel = defineMiniZodModel('users', {
  email: zm.string(),
  createdAt: zxm.date()
}).index('by_email', ['email'])

export const MiniSchema = defineMiniZodSchema({
  users: MiniUserModel
})

export const MiniApi = initMiniZodvex(MiniSchema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction
})

// Keep the emitted database surface honest as well as the source type suite.
import type { GenericId } from 'convex/values'
import type { InferDataModel, ZodvexDatabaseWriter } from 'zodvex/server'

declare const db: ZodvexDatabaseWriter<InferDataModel<typeof FullSchema>, {
  users: z.output<typeof FullUserModel.schema.doc>
}>
declare const userId: GenericId<'users'>
const decoded = db.get('users', userId)
decoded.then(user => user?.createdAt.getTime())
db.insert('users', { email: 'a@example.com', createdAt: new Date() })
db.patch('users', userId, { createdAt: new Date() })
// @ts-expect-error Unknown tables must not select a declaration fallback.
db.insert('missing', {})
// @ts-expect-error Both calling conventions require decoded codec values.
db.patch(userId, { createdAt: 42 })
// @ts-expect-error Table-first writes must not select a declaration fallback.
db.patch('users', userId, { createdAt: 42 })
// @ts-expect-error Replacements must supply required fields.
db.replace('users', userId, { email: 'a@example.com' })
