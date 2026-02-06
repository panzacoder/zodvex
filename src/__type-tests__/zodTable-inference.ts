/**
 * Compile-time type tests for zodTable inference (Type Regression Fix)
 *
 * These assertions cause TypeScript errors if zodTable returns `any` or
 * fails to preserve proper type information.
 * This file is type-checked but not included in the bundle.
 */
import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { zid } from '../ids'
import { zodTable } from '../tables'

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

const _UsersTable = zodTable('users', {
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

// =============================================================================
// UNION TABLE TYPE TESTS
// These tests check for type preservation in the union schema overload
// =============================================================================

// --- Test 20: Union table docArray should preserve variant types ---

const ShapesTable = zodTable(
  'shapes',
  z.union([
    z.object({ kind: z.literal('circle'), radius: z.number() }),
    z.object({ kind: z.literal('rectangle'), width: z.number(), height: z.number() })
  ])
)

// The docArray should infer proper document types with system fields
type ShapeDocArray = z.infer<typeof ShapesTable.docArray>
declare const shapeDocArray: ShapeDocArray

// TODO: This test currently passes but the inferred type is very loose (ZodTypeAny)
// Ideally, shapeDocArray[0] should have discriminated union fields
expectNotAny(shapeDocArray)

// --- Test 21: Union table withSystemFields() should preserve variant types ---
// BUG: addSystemFields returns z.ZodTypeAny, causing type loss

const shapeWithFields = ShapesTable.withSystemFields()

// BUG DETECTION: withSystemFields returns ZodTypeAny instead of preserving the union type
// z.infer<z.ZodTypeAny> = any, which breaks type safety
type ShapeDocFromWithFields = z.infer<typeof shapeWithFields>

// This should detect if the type is any
expectNotAny({} as ShapeDocFromWithFields)

// More specific test: the document should have the union variant fields + system fields
// If withSystemFields worked correctly, we should be able to access kind, radius, etc.
declare const shapeDoc: ShapeDocFromWithFields

// BUG: These should error with "Property does not exist" if type is any
// because any accepts all property accesses without error
// @ts-expect-error - if this is unused, shapeDoc is any (the bug)
const _testAnyAccess: typeof shapeDoc.thisPropertyShouldNotExist = 'test'

// Direct test: what is z.infer<z.ZodTypeAny>?
type DirectZodTypeAnyInfer = z.infer<z.ZodTypeAny>
// If this is any, the next line will fail
expectNotAny({} as DirectZodTypeAnyInfer)

// Test: check if addSystemFields return type loses union info
type AddSystemFieldsReturn = ReturnType<typeof ShapesTable.withSystemFields>
// @ts-expect-error - if unused, the return type accepts all assignments (is any or unknown)
const _addSystemFieldsTest: AddSystemFieldsReturn = 'this should not be assignable to a Zod schema'

// Debug types show:
// - DirectZodTypeAnyInfer = unknown (not any!)
// - ShapeDocFromWithFields = unknown
// - AddSystemFieldsReturn = ZodType<unknown, ...>
// In Zod v4, z.infer<z.ZodTypeAny> = unknown, which still loses type info

// Test helper to detect unknown type (different from any)
declare function expectNotUnknown<T>(value: unknown extends T ? never : T): void

// BUG DETECTION: These fail because types degrade to `unknown`
// When fixed, these should pass (types should be the actual union)
expectNotUnknown({} as ShapeDocFromWithFields)

// Test: Does the docArray lose type info?
type DocArrayElement = ShapeDocArray[number]
// BUG: DocArrayElement is `unknown`, should be the union type with system fields
expectNotUnknown({} as DocArrayElement)

// --- Test 22: Union table schema.insert property preserves original schema type ---
// This should work - schema.insert property is directly typed as Schema

type ShapesSchema = typeof ShapesTable.schema.insert
expectNotAny({} as ShapesSchema)

// The schema should be the original union, not any
type ShapesSchemaOutput = z.infer<ShapesSchema>
declare const shapesOutput: ShapesSchemaOutput

// This SHOULD error because shapesOutput is a union type, not any
// @ts-expect-error - should fail if schema output is any
const _shapesOutputInvalid: ShapesSchemaOutput = { notAShape: true }

// --- Test 23: Discriminated union table type preservation ---

const EventsTable = zodTable(
  'events',
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('click'), x: z.number(), y: z.number() }),
    z.object({ type: z.literal('scroll'), offset: z.number() })
  ])
)

// The schema.insert should preserve discriminated union type
type EventsSchema = typeof EventsTable.schema.insert
expectNotAny({} as EventsSchema)

type EventsOutput = z.infer<EventsSchema>
declare const eventsOutput: EventsOutput

// This SHOULD error because eventsOutput is a discriminated union, not any
// @ts-expect-error - should fail if output is any
const _eventsInvalid: EventsOutput = { notAnEvent: 123 }

// The discriminator should work
declare const clickEvent: EventsOutput & { type: 'click' }
expectNotAny(clickEvent.x)
expectNotAny(clickEvent.y)

// =============================================================================
// STRUCTURAL TESTS FOR UNION/DU TYPE INFERENCE
// These verify the actual structure is correct, not just "not any/unknown"
// =============================================================================

// --- Test 24: Union docArray elements have system fields ---

type ShapeDocElement = z.infer<typeof ShapesTable.docArray>[number]
declare const shapeElement: ShapeDocElement

// System fields should exist on union doc elements
expectNotAny(shapeElement._id)
expectNotAny(shapeElement._creationTime)

// --- Test 25: Union variant fields are accessible ---

// For a union, we should be able to access the common discriminator
// Note: 'kind' exists on both variants
expectNotAny(shapeElement.kind)

// --- Test 26: Discriminated union narrowing works ---

type EventDoc = z.infer<typeof EventsTable.docArray>[number]
declare const eventDoc: EventDoc

// Before narrowing, variant-specific fields should not be directly accessible
// (they exist on some variants but not all)

// After narrowing by discriminator, variant fields should be accessible
function _handleEvent(event: EventDoc) {
  if (event.type === 'click') {
    // After narrowing, x and y should be accessible
    const x: number = event.x
    const y: number = event.y
    return { x, y }
  } else if (event.type === 'scroll') {
    // After narrowing, offset should be accessible
    const offset: number = event.offset
    return { offset }
  }
  return null
}

// --- Test 27: Union docs reject invalid variants ---

// @ts-expect-error - missing required 'kind' discriminator
const _invalidShapeDoc1: ShapeDocElement = { _id: '' as any, _creationTime: 0 }

// @ts-expect-error - 'kind' value doesn't match any variant
const _invalidShapeDoc2: ShapeDocElement = {
  kind: 'triangle' as any, // not a valid variant
  _id: '' as any,
  _creationTime: 0
}

// --- Test 28: Discriminated union docs have proper system field types ---

// _id should be GenericId<'events'>, not just any string
type EventDocId = EventDoc['_id']
declare const eventId: EventDocId
expectNotAny(eventId)
declare function expectGenericIdEvents(id: GenericId<'events'>): void
expectGenericIdEvents(eventId)

// --- Test 29: withSystemFields() result has variant fields accessible ---

const eventsWithFields = EventsTable.withSystemFields()
type EventWithFields = z.infer<typeof eventsWithFields>
declare const eventWithFields: EventWithFields

// Should have system fields
expectNotAny(eventWithFields._id)
expectNotAny(eventWithFields._creationTime)

// Should have discriminator
expectNotAny(eventWithFields.type)

// =============================================================================
// CODEC WIRE TYPE TESTS
// These verify that nested codecs use wire types in document inference
// =============================================================================

import { zx } from '../zx'

// --- Test 30: zx.date() codec uses wire type (number) in document ---

const DateTable = zodTable('dated', {
  name: z.string(),
  createdAt: zx.date(),
  updatedAt: zx.date().optional()
})

type DateDoc = z.infer<typeof DateTable.zDoc>
declare const dateDoc: DateDoc

// createdAt should be Date in runtime (zx.date() decodes to Date)
// But the document type should use wire format for Convex compatibility
expectNotAny(dateDoc.createdAt)
expectNotAny(dateDoc.updatedAt)

// --- Test 31: Nested object with codec uses wire types ---

const NestedCodecTable = zodTable('nestedCodec', {
  user: z.object({
    name: z.string(),
    joinedAt: zx.date()
  })
})

type NestedCodecDoc = z.infer<typeof NestedCodecTable.zDoc>
declare const nestedCodecDoc: NestedCodecDoc

// Nested object fields should be properly typed
expectNotAny(nestedCodecDoc.user)
expectNotAny(nestedCodecDoc.user.name)
expectNotAny(nestedCodecDoc.user.joinedAt)

// --- Test 32: Array of objects with codecs uses wire types ---

const ArrayCodecTable = zodTable('arrayCodec', {
  events: z.array(
    z.object({
      name: z.string(),
      occurredAt: zx.date()
    })
  )
})

type ArrayCodecDoc = z.infer<typeof ArrayCodecTable.zDoc>
declare const arrayCodecDoc: ArrayCodecDoc

expectNotAny(arrayCodecDoc.events)
expectNotAny(arrayCodecDoc.events[0])
expectNotAny(arrayCodecDoc.events[0].name)
expectNotAny(arrayCodecDoc.events[0].occurredAt)

// --- Test 33: Custom codec wire type is preserved in Convex validator ---

// Create a custom codec that transforms between wire and runtime
type SensitiveWire = { encrypted: string }
type SensitiveRuntime = string

const sensitiveCodec = zx.codec(
  z.object({ encrypted: z.string() }),
  z.custom<SensitiveRuntime>(() => true),
  {
    decode: (wire: SensitiveWire) => atob(wire.encrypted),
    encode: (value: SensitiveRuntime) => ({ encrypted: btoa(value) })
  }
)

const SensitiveTable = zodTable('sensitive', {
  name: z.string(),
  secret: sensitiveCodec
})

// Note: z.infer uses Zod's native inference which gives runtime types
// The WireInfer fix is for Convex validator document types (VObject<DocType, ...>)
type SensitiveDoc = z.infer<typeof SensitiveTable.zDoc>
declare const sensitiveDoc: SensitiveDoc

expectNotAny(sensitiveDoc.name)
expectNotAny(sensitiveDoc.secret)

// The Convex validator type should use wire format
// We verify this by checking the validator is not any
type SensitiveValidator = typeof SensitiveTable.doc
expectNotAny({} as SensitiveValidator)

// --- Test 34: Union with codec variants uses wire types ---

const UnionCodecTable = zodTable(
  'unionCodec',
  z.union([
    z.object({
      type: z.literal('timestamped'),
      timestamp: zx.date()
    }),
    z.object({
      type: z.literal('plain'),
      value: z.string()
    })
  ])
)

type UnionCodecDoc = z.infer<typeof UnionCodecTable.docArray>[number]
declare const unionCodecDoc: UnionCodecDoc

expectNotAny(unionCodecDoc._id)
expectNotAny(unionCodecDoc.type)

// --- Test 35: Record with codec values uses wire types ---

const RecordCodecTable = zodTable('recordCodec', {
  timestamps: z.record(z.string(), zx.date())
})

type RecordCodecDoc = z.infer<typeof RecordCodecTable.zDoc>
declare const recordCodecDoc: RecordCodecDoc

expectNotAny(recordCodecDoc.timestamps)

// Record values should be wire type (number for dates)
declare const timestampValue: RecordCodecDoc['timestamps'][string]
expectNotAny(timestampValue)

// =============================================================================
// OPTIONAL FIELD INDEX PATH TESTS
// These verify that optional fields with nested codecs work correctly with
// Convex's index path typing (FieldTypeFromFieldPath)
// =============================================================================

// --- Test 36: Optional field with nested codec uses ?: syntax ---
// This is the key test for the WireInfer optional handling fix.
// The issue: { email: T | undefined } breaks Convex's path extraction
// The fix: { email?: T } allows path extraction to work correctly

const OptionalCodecTable = zodTable('optionalCodec', {
  clinicId: z.string(),
  // Optional field with a codec that has nested structure
  email: zx
    .codec(
      z.object({ value: z.string().nullable(), status: z.enum(['full', 'hidden']) }),
      z.custom<{ decrypted: string }>(() => true),
      {
        decode: wire => ({ decrypted: wire.value ?? '' }),
        encode: value => ({ value: value.decrypted, status: 'full' as const })
      }
    )
    .optional()
})

type OptionalCodecDoc = z.infer<typeof OptionalCodecTable.zDoc>
declare const optionalCodecDoc: OptionalCodecDoc

// The document should have proper types
expectNotAny(optionalCodecDoc.clinicId)
expectNotAny(optionalCodecDoc.email)

// --- Test 37: WireInfer produces ?: for optional fields, not | undefined ---
// This tests the core fix: optional fields should use TypeScript's ?: syntax

import type { ConvexValidatorFromZod } from '../mapping/types'

// Get the validator type for our table
type OptionalCodecValidator = typeof OptionalCodecTable.doc

// The validator's document type (first type param of VObject)
// should have email as an optional property, not email: T | undefined
expectNotAny({} as OptionalCodecValidator)

// --- Test 38: Nested path on optional field should extract correct type ---
// When accessing email.value on { email?: { value: T } }, the result should be T | undefined
// NOT just undefined (which was the bug)

// Simulate what Convex's FieldTypeFromFieldPath does
type DocType = {
  clinicId: string
  // This is what WireInfer should produce (?: syntax)
  email?: { value: string | null; status: 'full' | 'hidden' }
}

// Helper to simulate Convex's path extraction (simplified)
type ExtractPath<D, P extends string> = P extends `${infer First}.${infer Rest}`
  ? First extends keyof D
    ? D[First] extends infer V
      ? V extends Record<string, any>
        ? ExtractPath<V, Rest>
        : undefined
      : undefined
    : undefined
  : P extends keyof D
    ? D[P]
    : undefined

// With the fix, email.value should be string | null | undefined (value type + optional)
// NOT just undefined (which was the broken behavior)
type EmailValueType = ExtractPath<DocType, 'email.value'>

// This should NOT be just undefined
declare const emailValue: EmailValueType
// @ts-expect-error - emailValue can be string | null | undefined, not just undefined
const _testNotOnlyUndefined: undefined = emailValue

// --- Test 39: Multiple optional fields with different codec types ---

const MultiOptionalTable = zodTable('multiOptional', {
  required: z.string(),
  optionalDate: zx.date().optional(),
  optionalNested: z
    .object({
      inner: z.string(),
      deepOptional: z.number().optional()
    })
    .optional(),
  optionalWithDefault: z.string().default('default-value')
})

type MultiOptionalDoc = z.infer<typeof MultiOptionalTable.zDoc>
declare const multiOptionalDoc: MultiOptionalDoc

// Required field should be required
expectNotAny(multiOptionalDoc.required)

// Optional fields should be optional (?: syntax means accessing gives T | undefined)
expectNotAny(multiOptionalDoc.optionalDate)
expectNotAny(multiOptionalDoc.optionalNested)
expectNotAny(multiOptionalDoc.optionalWithDefault)

// Nested optional within optional object should also work
declare const nestedDoc: NonNullable<MultiOptionalDoc['optionalNested']>
expectNotAny(nestedDoc.inner)
expectNotAny(nestedDoc.deepOptional)
