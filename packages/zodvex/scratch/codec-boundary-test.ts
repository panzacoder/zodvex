/**
 * Type-level test: does T["table"]["schema"]["doc"] preserve the specific
 * Zod type through defineZodSchema's generic constraint, such that
 * z.output<> gives decoded types (Date, not number)?
 *
 * Result: YES — z.output<T[K]["schema"]["doc"]> correctly resolves to
 * Date for zx.date() fields, proving DecodedDocFor<T> works.
 */
import { z } from 'zod'
import { zx } from '../src/core/index'
import type { ZodTableSchemas } from '../src/schema'

// ---------- Simulate the constraint chain ----------

type ZodSchemaEntry = {
  schema: ZodTableSchemas
  [key: string]: any
}

type DecodedDocFor<T extends Record<string, ZodSchemaEntry>> = {
  [K in keyof T & string]: T[K]['schema']['doc'] extends z.ZodTypeAny
    ? z.output<T[K]['schema']['doc']>
    : never
}

// ---------- Simulate a model with codecs ----------

const userFields = {
  name: z.string(),
  email: z.string(),
  createdAt: zx.date(), // codec: wire=number, runtime=Date
}

const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  ...userFields,
})

const UserModel = {
  schema: {
    doc: userDocSchema,
    docArray: z.array(userDocSchema),
    base: z.object(userFields),
    insert: z.object(userFields),
    update: z.object(userFields).partial(),
  },
  name: 'users' as const,
  fields: userFields,
  indexes: {} as Record<string, readonly string[]>,
  searchIndexes: {},
  vectorIndexes: {},
}

// ---------- Test ----------

function testPreservation<T extends Record<string, ZodSchemaEntry>>(_tables: T): DecodedDocFor<T> {
  return {} as any
}

const result = testPreservation({ users: UserModel })
type UsersDecoded = typeof result.users

// Positive: Date fields accept Date
const _checkDate: UsersDecoded = {
  _id: 'abc',
  _creationTime: 123,
  name: 'test',
  email: 'test@test.com',
  createdAt: new Date(),
}

// Negative: Date fields reject number
// @ts-expect-error createdAt should be Date, not number
const _checkNumber: UsersDecoded['createdAt'] = 12345

// String fields are unaffected by codecs
const _checkString: UsersDecoded['name'] = 'hello'

void [_checkDate, _checkNumber, _checkString]
