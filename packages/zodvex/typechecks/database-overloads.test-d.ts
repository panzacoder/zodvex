import type { GenericId } from 'convex/values'
import type { ZodvexDatabaseWriter } from '../src/internal/db'
import type { Equal, Expect } from './test-helpers'

type EventDoc = { _id: GenericId<'events'>; _creationTime: number; name: string; at: number }
type UserDoc = { _id: GenericId<'users'>; _creationTime: number; email: string }
type Table<Doc> = {
  document: Doc
  fieldPaths: keyof Doc & string
  indexes: Record<string, never>
  searchIndexes: Record<string, never>
  vectorIndexes: Record<string, never>
}
type Model = { events: Table<EventDoc>; users: Table<UserDoc> }
type DecodedEvent = Omit<EventDoc, 'at'> & { at: Date }
declare const db: ZodvexDatabaseWriter<Model, { events: DecodedEvent }>
declare const eventId: GenericId<'events'>
declare const userId: GenericId<'users'>

const nativeRead = db.get(eventId)
const tableRead = db.get('events', eventId)
const wireRead = db.get('users', userId)
type _NativeRead = Expect<Equal<Awaited<typeof nativeRead>, DecodedEvent | null>>
type _TableRead = Expect<Equal<Awaited<typeof tableRead>, DecodedEvent | null>>
type _WireRead = Expect<Equal<Awaited<typeof wireRead>, UserDoc | null>>
const inserted = db.insert('events', { name: 'Launch', at: new Date() })
type _Inserted = Expect<Equal<Awaited<typeof inserted>, GenericId<'events'>>>
db.insert('users', { email: 'a@example.com' })
db.patch(eventId, { at: new Date() })
db.patch('events', eventId, { at: new Date() })
db.replace(eventId, { name: 'Launch', at: new Date() })
db.replace('events', eventId, { name: 'Launch', at: new Date() })
db.delete(eventId)
db.delete('events', eventId)

// @ts-expect-error Unknown table names cannot select a fallback overload.
db.insert('missing', {})
// @ts-expect-error Required fields remain required.
db.insert('events', { name: 'Launch' })
// @ts-expect-error Codec writes accept decoded values.
db.insert('events', { name: 'Launch', at: 42 })
// @ts-expect-error Foreign fields cannot widen the table inference.
db.insert('events', { email: 'a@example.com' })
// @ts-expect-error IDs must be branded.
db.get('plain-id')
// @ts-expect-error Table-first lookups must use the matching ID.
db.get('events', userId)
// @ts-expect-error Unknown table names are rejected.
db.get('missing', eventId)
// @ts-expect-error Native patches require decoded values.
db.patch(eventId, { at: 42 })
// @ts-expect-error Table-first patches require decoded values.
db.patch('events', eventId, { at: 42 })
// @ts-expect-error The ID cannot widen the explicit table.
db.patch('events', userId, {})
// @ts-expect-error Unknown fields are rejected.
db.patch(eventId, { email: 'a@example.com' })
// @ts-expect-error Replacements require every required field.
db.replace(eventId, { at: new Date() })
// @ts-expect-error Table-first replacements require decoded values.
db.replace('events', eventId, { name: 'Launch', at: 42 })
// @ts-expect-error The ID cannot widen the explicit table.
db.replace('events', userId, { name: 'Launch', at: new Date() })
// @ts-expect-error The ID cannot widen the explicit table.
db.delete('events', userId)
// @ts-expect-error Native deletes require branded IDs.
db.delete('plain-id')
// @ts-expect-error Unknown tables are rejected.
db.delete('missing', eventId)

type NoticeDoc = { _id: GenericId<'notices'>; _creationTime: number } & (
  | { kind: 'email'; subject: string; at: Date }
  | { kind: 'push'; title: string; at: Date }
)
type NoticeWire = { _id: GenericId<'notices'>; _creationTime: number } & (
  | { kind: 'email'; subject: string; at: number }
  | { kind: 'push'; title: string; at: number }
)
declare const notices: ZodvexDatabaseWriter<{ notices: Table<NoticeWire> }, { notices: NoticeDoc }>
declare const noticeId: GenericId<'notices'>
notices.insert('notices', { kind: 'email', subject: 'Hello', at: new Date() })
notices.insert('notices', { kind: 'push', title: 'Hello', at: new Date() })
notices.replace(noticeId, { kind: 'email', subject: 'Hello', at: new Date() })
notices.replace('notices', noticeId, { kind: 'push', title: 'Hello', at: new Date() })
notices.patch(noticeId, { subject: 'Updated' })
notices.patch('notices', noticeId, { title: 'Updated' })
// @ts-expect-error Each union member retains its required fields.
notices.insert('notices', { kind: 'email', at: new Date() })
// @ts-expect-error Discriminators must match the variant's fields.
notices.replace(noticeId, { kind: 'push', subject: 'Hello', at: new Date() })
// @ts-expect-error Union writes require decoded codec values.
notices.insert('notices', { kind: 'email', subject: 'Hello', at: 42 })
// @ts-expect-error Patch field types remain checked.
notices.patch(noticeId, { subject: 42 })
