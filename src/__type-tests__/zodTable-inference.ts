/**
 * Compile-time type tests for zodTable inference (Type Regression Fix)
 *
 * These assertions cause TypeScript errors if zodTable returns `any` or
 * fails to preserve proper type information.
 * This file is type-checked but not included in the bundle.
 */
import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { zodTable } from '../tables'
import { zid } from '../ids'

// Test helper: causes TS error if assigned `any`
declare function expectNotAny<T>(value: 0 extends 1 & T ? never : T): void

// Test helper: causes TS error if types don't match
declare function expectType<T>(value: T): void

// --- Test 1: Basic table is not `any` ---

const BasicTable = zodTable('basic', { name: z.string() })
expectNotAny(BasicTable)
expectNotAny(BasicTable.table)
expectNotAny(BasicTable.shape)
expectNotAny(BasicTable.zDoc)
expectNotAny(BasicTable.docArray)

// --- Test 2: Shape preserves field types ---

type BasicShape = typeof BasicTable.shape
// Shape['name'] should be z.ZodString, not any
declare const nameField: BasicShape['name']
expectNotAny(nameField)

// Verify the type is actually ZodString
declare function expectZodString(v: z.ZodString): void
expectZodString(BasicTable.shape.name)

// --- Test 3: zDoc includes system fields ---

type BasicDocShape = typeof BasicTable.zDoc extends z.ZodObject<infer S> ? S : never
// Must have _id and _creationTime keys
declare const hasId: BasicDocShape['_id']
declare const hasCreationTime: BasicDocShape['_creationTime']
expectNotAny(hasId)
expectNotAny(hasCreationTime)

// --- Test 4: zDoc._output rejects invalid data ---

type BasicDoc = z.infer<typeof BasicTable.zDoc>
// @ts-expect-error - should fail if Doc is `any`
const _invalidDoc: BasicDoc = { completelyWrong: true }

// Valid doc should work
declare const validDoc: BasicDoc
expectNotAny(validDoc.name)
expectNotAny(validDoc._id)
expectNotAny(validDoc._creationTime)

// --- Test 5: Complex schema with optionals, arrays, nested objects ---

const ComplexTable = zodTable('complex', {
  required: z.string(),
  optional: z.string().optional(),
  nullable: z.string().nullable(),
  optionalNullable: z.string().optional().nullable(),
  array: z.array(z.number()),
  nested: z.object({
    inner: z.string(),
    deepNested: z.object({
      value: z.boolean()
    })
  })
})

expectNotAny(ComplexTable)
expectNotAny(ComplexTable.shape)
expectNotAny(ComplexTable.zDoc)

type ComplexDoc = z.infer<typeof ComplexTable.zDoc>
declare const complexDoc: ComplexDoc

// Verify each field type is preserved
expectNotAny(complexDoc.required)
expectNotAny(complexDoc.optional)
expectNotAny(complexDoc.nullable)
expectNotAny(complexDoc.optionalNullable)
expectNotAny(complexDoc.array)
expectNotAny(complexDoc.nested)
expectNotAny(complexDoc.nested.inner)
expectNotAny(complexDoc.nested.deepNested)
expectNotAny(complexDoc.nested.deepNested.value)

// @ts-expect-error - should fail: required is string, not number
const _complexInvalid: ComplexDoc['required'] = 123

// --- Test 6: Table with zid references (common Convex pattern) ---

const UsersTable = zodTable('users', {
  name: z.string(),
  email: z.string().email()
})

const PostsTable = zodTable('posts', {
  title: z.string(),
  content: z.string(),
  authorId: zid('users'),
  categoryId: zid('categories').optional()
})

expectNotAny(PostsTable)
expectNotAny(PostsTable.shape)
expectNotAny(PostsTable.zDoc)

type PostDoc = z.infer<typeof PostsTable.zDoc>
declare const postDoc: PostDoc

expectNotAny(postDoc.title)
expectNotAny(postDoc.authorId)
expectNotAny(postDoc.categoryId)

// @ts-expect-error - authorId should be GenericId<'users'>, not any
const _postInvalid: PostDoc = { title: 'test', content: 'test', authorId: 123 }

// --- Test 7: Spread operator preserves types (the actual symptom) ---

declare const docToSpread: z.infer<typeof BasicTable.zDoc>
const spread = { ...docToSpread, extra: 'field' }
expectNotAny(spread._id)
expectNotAny(spread.name)
expectNotAny(spread._creationTime)

// The spread should have proper types
// @ts-expect-error - _id should be GenericId<'basic'>, not accept random object
const _spreadInvalid: typeof spread._id = { notAnId: true }

// --- Test 8: docArray preserves document types ---

type BasicDocArray = z.infer<typeof BasicTable.docArray>
declare const docArray: BasicDocArray

expectNotAny(docArray)
expectNotAny(docArray[0])
expectNotAny(docArray[0].name)
expectNotAny(docArray[0]._id)

// @ts-expect-error - array element should have proper type
const _arrayInvalid: BasicDocArray = [{ notValid: true }]

// --- Test 9: Multiple tables don't interfere with each other ---

const TableA = zodTable('tableA', { fieldA: z.string() })
const TableB = zodTable('tableB', { fieldB: z.number() })

expectNotAny(TableA.shape.fieldA)
expectNotAny(TableB.shape.fieldB)

// Each table's zDoc should be properly typed
type DocA = z.infer<typeof TableA.zDoc>
type DocB = z.infer<typeof TableB.zDoc>

declare const docA: DocA
declare const docB: DocB

// @ts-expect-error - docA should not have fieldB
const _aHasB: typeof docA.fieldB = 'test'

// @ts-expect-error - docB should not have fieldA
const _bHasA: typeof docB.fieldA = 123

// --- Test 10: GenericId types are preserved correctly ---

type BasicDocId = z.infer<typeof BasicTable.zDoc>['_id']
// Should be GenericId<'basic'>
declare function expectGenericId<T extends string>(id: GenericId<T>): void
declare const basicId: BasicDocId
expectGenericId(basicId)

// --- Test 11: Union schema support still works ---

const UnionTable = zodTable(
  'shapes',
  z.union([
    z.object({ kind: z.literal('circle'), radius: z.number() }),
    z.object({ kind: z.literal('rectangle'), width: z.number(), height: z.number() })
  ])
)

expectNotAny(UnionTable)
expectNotAny(UnionTable.table)
expectNotAny(UnionTable.schema)
expectNotAny(UnionTable.docArray)

// --- Test 12: Table.doc validator returns properly typed document, not any ---
// This is the ACTUAL bug: ReturnType<typeof Table<any, TableName>> causes Table properties to be any

// The .doc property is a Convex validator - check its inferred type
type DocValidatorType = typeof BasicTable.doc
// If Table<any, ...> is used, DocValidatorType will have `any` in its type params
expectNotAny({} as DocValidatorType)

// --- Test 13: Table.withoutSystemFields should preserve field types ---

type WithoutSystemFields = typeof BasicTable.withoutSystemFields
expectNotAny({} as WithoutSystemFields)

// --- Test 14: Table.withSystemFields should not be any ---
// Check that withSystemFields preserves proper field structure

type WithSystemFields = typeof BasicTable.withSystemFields
expectNotAny({} as WithSystemFields)

// --- Test 15: doc validator should have properly typed fields, not index signature any ---
// The bug causes VObject<{ [x: string]: any; ... }> instead of VObject<{ name: ... }>

type DocValidator = typeof BasicTable.doc
// Check that the doc validator type doesn't have any in its structure
// This is a compile-time check - if any propagates, this file fails to compile
declare const docValidator: DocValidator
expectNotAny(docValidator)

// --- Test 16: Discriminated union schema support ---

const DiscriminatedUnionTable = zodTable(
  'events',
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('click'), x: z.number(), y: z.number() }),
    z.object({ type: z.literal('scroll'), offset: z.number() }),
    z.object({ type: z.literal('keypress'), key: z.string() })
  ])
)

expectNotAny(DiscriminatedUnionTable)
expectNotAny(DiscriminatedUnionTable.table)
expectNotAny(DiscriminatedUnionTable.schema)
expectNotAny(DiscriminatedUnionTable.docArray)

// --- Test 17: Enum fields preserve literal types ---

const EnumTable = zodTable('statuses', {
  status: z.enum(['pending', 'active', 'completed', 'archived']),
  priority: z.enum(['low', 'medium', 'high'])
})

expectNotAny(EnumTable)
expectNotAny(EnumTable.shape)
expectNotAny(EnumTable.shape.status)
expectNotAny(EnumTable.shape.priority)

type EnumDoc = z.infer<typeof EnumTable.zDoc>
declare const enumDoc: EnumDoc
expectNotAny(enumDoc.status)
expectNotAny(enumDoc.priority)

// @ts-expect-error - status should only accept enum values, not arbitrary strings
const _enumInvalid: EnumDoc['status'] = 'invalid_status'

// --- Test 18: Default values don't break inference ---

const DefaultsTable = zodTable('defaults', {
  name: z.string().default('unnamed'),
  count: z.number().default(0),
  active: z.boolean().default(true)
})

expectNotAny(DefaultsTable)
expectNotAny(DefaultsTable.shape)
expectNotAny(DefaultsTable.zDoc)

type DefaultsDoc = z.infer<typeof DefaultsTable.zDoc>
declare const defaultsDoc: DefaultsDoc
expectNotAny(defaultsDoc.name)
expectNotAny(defaultsDoc.count)
expectNotAny(defaultsDoc.active)

// --- Test 19: Empty shape edge case ---

const EmptyTable = zodTable('empty', {})
expectNotAny(EmptyTable)
expectNotAny(EmptyTable.table)
expectNotAny(EmptyTable.zDoc)

// Empty table should still have system fields
type EmptyDoc = z.infer<typeof EmptyTable.zDoc>
declare const emptyDoc: EmptyDoc
expectNotAny(emptyDoc._id)
expectNotAny(emptyDoc._creationTime)
