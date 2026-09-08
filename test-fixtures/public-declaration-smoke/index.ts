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

const NoticeModel = defineZodModel('notices', z.union([
  z.object({ kind: z.literal('email'), subject: z.string(), at: zx.date() }),
  z.object({ kind: z.literal('push'), title: z.string(), at: zx.date() })
]))
const NoticeSchema = defineZodSchema({ notices: NoticeModel })
declare const notices: ZodvexDatabaseWriter<InferDataModel<typeof NoticeSchema>, {
  notices: z.output<typeof NoticeModel.schema.doc>
}>
declare const noticeId: GenericId<'notices'>
notices.patch(noticeId, { kind: 'email', subject: 'Updated', at: new Date() })
notices.patch('notices', noticeId, { kind: 'push', title: 'Updated', at: new Date() })
// @ts-expect-error Emitted patch types must reflect the union encoder's full-variant requirement.
notices.patch(noticeId, { subject: 'Updated' })
// @ts-expect-error Table-first calls must enforce the same union patch requirement.
notices.patch('notices', noticeId, { title: 'Updated' })
// @ts-expect-error The model-inferred email variant requires subject.
notices.insert('notices', { kind: 'email', at: new Date() })
// @ts-expect-error Union replacements retain their variant-specific required fields too.
notices.replace(noticeId, { kind: 'push', at: new Date() })

// Exercise string index signatures explicitly, independently of model inference.
type IndexedNoticeDoc = {
  [key: string]: unknown
  _id: GenericId<'notices'>
  _creationTime: number
} & (
  | { kind: 'email'; subject: string; at: Date }
  | { kind: 'push'; title: string; at: Date }
)
declare const indexedNotices: ZodvexDatabaseWriter<InferDataModel<typeof NoticeSchema>, {
  notices: IndexedNoticeDoc
}>
indexedNotices.insert('notices', { kind: 'email', subject: 'Hello', at: new Date() })
indexedNotices.patch(noticeId, { kind: 'push', title: 'Updated', at: new Date() })
// @ts-expect-error Explicit index signatures must retain required named insert fields.
indexedNotices.insert('notices', { kind: 'email', at: new Date() })
// @ts-expect-error Explicit index signatures must retain required named patch fields.
indexedNotices.patch(noticeId, { kind: 'push', at: new Date() })

// Named contracts stay usable through emitted declarations and generic wrappers.
import type { ZodvexPatchValue, ZodvexWriteValue } from 'zodvex/server'
import type { ZodvexPatchValue as MiniPatchValue, ZodvexWriteValue as MiniWriteValue } from 'zodvex/mini/server'
type ConsumerModel = InferDataModel<typeof FullSchema> & InferDataModel<typeof NoticeSchema>
type ConsumerDocs = {
  users: z.output<typeof FullUserModel.schema.doc>
  notices: z.output<typeof NoticeModel.schema.doc>
}
declare const consumerDb: ZodvexDatabaseWriter<ConsumerModel, ConsumerDocs>
export function patchConsumer<T extends keyof ConsumerModel>(
  table: T,
  id: GenericId<NoInfer<T>>,
  patch: ZodvexPatchValue<ConsumerModel, ConsumerDocs, NoInfer<T>>
) {
  return consumerDb.patch(table, id, patch)
}
export function insertConsumer<T extends keyof ConsumerModel>(
  table: T,
  value: ZodvexWriteValue<ConsumerModel, ConsumerDocs, NoInfer<T>>
) {
  return consumerDb.insert(table, value)
}
patchConsumer('users', userId, { createdAt: new Date() })
patchConsumer('notices', noticeId, { kind: 'push', title: 'Updated', at: new Date() })
// @ts-expect-error Public union patch types require a complete variant.
patchConsumer('notices', noticeId, { title: 'Updated' })
// @ts-expect-error Public generic wrappers preserve decoded codec inputs.
patchConsumer('users', userId, { createdAt: 42 })
// @ts-expect-error Required fields survive through public write-value aliases.
insertConsumer('users', { createdAt: new Date() })
const miniPatch: MiniPatchValue<ConsumerModel, ConsumerDocs, 'users'> = { createdAt: new Date() }
const miniWrite: MiniWriteValue<ConsumerModel, ConsumerDocs, 'users'> = { email: 'a@example.com', createdAt: new Date() }
patchConsumer('users', userId, miniPatch)
insertConsumer('users', miniWrite)
