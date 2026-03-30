/**
 * Spike: FieldPaths type-level extraction for defineZodModel
 *
 * Goal: Prove that we can extract Convex-compatible field paths from Zod schemas
 * at the TYPE level, giving full Layer 1 validation (field existence checking)
 * when defining indexes on defineZodModel.
 *
 * Approach: Extract paths from z.input<T> (wire format) rather than walking
 * the Zod schema type hierarchy. This naturally handles codecs because indexes
 * operate on wire-format data (what Convex stores).
 */

import type { GenericId } from 'convex/values'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodvexCodec } from '../src/codec'
import type { ZodvexCodec } from '../src/types'
import { zx } from '../src/zx'

// ============================================================================
// Type Utilities Under Test
// ============================================================================

/**
 * Extract all valid field paths from a TypeScript object type.
 * Mirrors Convex's ExtractFieldPaths but operates on plain TS types.
 *
 * - Recurses into nested objects to produce dotted paths ("address.city")
 * - Distributes over unions (T extends T trick)
 * - Excludes arrays (can't index into array elements)
 * - Unwraps nullable/optional via NonNullable before recursing
 */
type FieldPaths<T> = T extends any[]
  ? never
  : T extends Record<string, any>
    ? T extends T // distribute over unions
      ? {
          [K in keyof T & string]:
            | K
            | (NonNullable<T[K]> extends any[]
                ? never
                : NonNullable<T[K]> extends Record<string, any>
                  ? `${K}.${FieldPaths<NonNullable<T[K]>>}`
                  : never)
        }[keyof T & string]
      : never
    : never

/**
 * Field paths valid for index definitions on a model.
 * Uses z.input<T> to get wire-format paths, plus _creationTime system field.
 */
type ModelFieldPaths<InsertSchema extends z.ZodTypeAny> =
  | FieldPaths<z.input<InsertSchema>>
  | '_creationTime'

// ============================================================================
// Type-Level Assertions (compile-time tests)
// ============================================================================

// Helper: assert type A is assignable to type B
type AssertAssignable<A, B> = A extends B ? true : false
// Helper: assert types are exactly equal
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// --- 1. Simple flat object ---

type FlatSchema = z.ZodObject<{
  name: z.ZodString
  age: z.ZodNumber
  active: z.ZodBoolean
}>

type FlatPaths = FieldPaths<z.input<FlatSchema>>
// Expected: "name" | "age" | "active"

type _flat1 = AssertEqual<FlatPaths, 'name' | 'age' | 'active'>
const _flatCheck: _flat1 = true

// --- 2. Nested object ---

type NestedSchema = z.ZodObject<{
  name: z.ZodString
  address: z.ZodObject<{
    city: z.ZodString
    zip: z.ZodNumber
  }>
}>

type NestedPaths = FieldPaths<z.input<NestedSchema>>
// Expected: "name" | "address" | "address.city" | "address.zip"

type _nested1 = AssertAssignable<'name', NestedPaths>
type _nested2 = AssertAssignable<'address', NestedPaths>
type _nested3 = AssertAssignable<'address.city', NestedPaths>
type _nested4 = AssertAssignable<'address.zip', NestedPaths>
const _nestedCheck1: _nested1 = true
const _nestedCheck2: _nested2 = true
const _nestedCheck3: _nested3 = true
const _nestedCheck4: _nested4 = true

// "address.bogus" should NOT be assignable
type _nestedBad = AssertAssignable<'address.bogus', NestedPaths>
const _nestedBadCheck: _nestedBad = false

// --- 3. Optional fields ---

type OptionalSchema = z.ZodObject<{
  name: z.ZodString
  nickname: z.ZodOptional<z.ZodString>
  address: z.ZodOptional<
    z.ZodObject<{
      city: z.ZodString
    }>
  >
}>

type OptionalPaths = FieldPaths<z.input<OptionalSchema>>
// "name", "nickname", "address", "address.city"

type _opt1 = AssertAssignable<'address.city', OptionalPaths>
const _optCheck1: _opt1 = true

// --- 4. zx.date() codec ---
// zx.date() wire format is number (timestamp). z.input should be number.
// So "createdAt" is a leaf — no sub-paths.

type DateSchema = z.ZodObject<{
  title: z.ZodString
  createdAt: ZxDate
}>
type ZxDate = ZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>

type DatePaths = FieldPaths<z.input<DateSchema>>
// Expected: "title" | "createdAt"

type _date1 = AssertEqual<DatePaths, 'title' | 'createdAt'>
const _dateCheck: _date1 = true

// --- 5. Custom field codec ---
// custom(z.string()) wire format is CustomWire<string>.
// z.input should give us { value: string | null, status: ..., __customField?: ..., reason?: ... }
// So "email.value", "email.status" should be valid paths.

// biome-ignore lint/correctness/noUnusedVariables: documents the wire shape for this test section
type CustomWire<T> = {
  value: T | null
  status: 'full' | 'hidden'
  __customField?: string
  reason?: string
}

// Simulate custom() codec: wire is z.object matching CustomWire, runtime is custom class
type CustomStringCodec = ZodvexCodec<
  z.ZodObject<{
    value: z.ZodNullable<z.ZodString>
    status: z.ZodEnum<['full', 'hidden']>
    __customField: z.ZodOptional<z.ZodString>
    reason: z.ZodOptional<z.ZodString>
  }>,
  z.ZodCustom<{ _brand: 'CustomField<string>' }>
>

type CustomFieldSchema = z.ZodObject<{
  clinicId: z.ZodString
  email: z.ZodOptional<CustomStringCodec>
}>

type CustomFieldPaths = FieldPaths<z.input<CustomFieldSchema>>
// Expected: "clinicId" | "email" | "email.value" | "email.status" | "email.__customField" | "email.reason"

type _cust1 = AssertAssignable<'clinicId', CustomFieldPaths>
type _cust2 = AssertAssignable<'email', CustomFieldPaths>
type _cust3 = AssertAssignable<'email.value', CustomFieldPaths>
type _cust4 = AssertAssignable<'email.status', CustomFieldPaths>
type _cust5 = AssertAssignable<'email.__customField', CustomFieldPaths>
const _custCheck1: _cust1 = true
const _custCheck2: _cust2 = true
const _custCheck3: _cust3 = true
const _custCheck4: _cust4 = true
const _custCheck5: _cust5 = true

// "email.bogus" should NOT be assignable
type _custBad = AssertAssignable<'email.bogus', CustomFieldPaths>
const _custBadCheck: _custBad = false

// --- 6. ModelFieldPaths adds _creationTime ---

type ModelPaths = ModelFieldPaths<CustomFieldSchema>

type _model1 = AssertAssignable<'_creationTime', ModelPaths>
type _model2 = AssertAssignable<'clinicId', ModelPaths>
const _modelCheck1: _model1 = true
const _modelCheck2: _model2 = true

// --- 7. Union type ---

type UnionSchema = z.ZodObject<{
  data: z.ZodUnion<
    [
      z.ZodObject<{ kind: z.ZodLiteral<'a'>; x: z.ZodNumber }>,
      z.ZodObject<{ kind: z.ZodLiteral<'b'>; y: z.ZodString }>
    ]
  >
}>

type UnionPaths = FieldPaths<z.input<UnionSchema>>
// Expected: "data" | "data.kind" | "data.x" | "data.y"

type _union1 = AssertAssignable<'data', UnionPaths>
type _union2 = AssertAssignable<'data.kind', UnionPaths>
type _union3 = AssertAssignable<'data.x', UnionPaths>
type _union4 = AssertAssignable<'data.y', UnionPaths>
const _unionCheck1: _union1 = true
const _unionCheck2: _union2 = true
const _unionCheck3: _union3 = true
const _unionCheck4: _union4 = true

// --- 8. Array fields are leaves (no sub-paths) ---

type ArraySchema = z.ZodObject<{
  tags: z.ZodArray<z.ZodString>
  items: z.ZodArray<z.ZodObject<{ name: z.ZodString }>>
}>

type ArrayPaths = FieldPaths<z.input<ArraySchema>>
// Expected: "tags" | "items" — NO "items.name" (can't index into arrays)

type _arr1 = AssertEqual<ArrayPaths, 'tags' | 'items'>
const _arrCheck: _arr1 = true

// --- 9. Nullable nested object ---

type NullableSchema = z.ZodObject<{
  profile: z.ZodNullable<
    z.ZodObject<{
      bio: z.ZodString
      avatar: z.ZodOptional<z.ZodString>
    }>
  >
}>

type NullablePaths = FieldPaths<z.input<NullableSchema>>
// Expected: "profile" | "profile.bio" | "profile.avatar"

type _null1 = AssertAssignable<'profile', NullablePaths>
type _null2 = AssertAssignable<'profile.bio', NullablePaths>
type _null3 = AssertAssignable<'profile.avatar', NullablePaths>
const _nullCheck1: _null1 = true
const _nullCheck2: _null2 = true
const _nullCheck3: _null3 = true

// ============================================================================
// defineZodModel Spike — Minimal API with .index()
// ============================================================================

/**
 * Minimal model type that carries schema + index info in the type system.
 */
type ZodModelCore<
  Name extends string,
  Fields extends z.ZodRawShape,
  InsertSchema extends z.ZodTypeAny,
  Indexes extends Record<string, readonly string[]>
> = {
  readonly name: Name
  readonly fields: Fields
  readonly schema: {
    readonly insert: InsertSchema
    readonly doc: z.ZodTypeAny
    readonly docArray: z.ZodTypeAny
  }
  readonly indexes: Indexes
  index<
    IndexName extends string,
    First extends ModelFieldPaths<InsertSchema>,
    Rest extends ModelFieldPaths<InsertSchema>[]
  >(
    name: IndexName,
    fields: readonly [First, ...Rest]
  ): ZodModelCore<
    Name,
    Fields,
    InsertSchema,
    Indexes & Record<IndexName, readonly [First, ...Rest, '_creationTime']>
  >
}

/**
 * Minimal defineZodModel — proves the type flow works.
 * NOT the final implementation — just enough to test .index() type safety.
 */
function defineZodModel<Name extends string, Fields extends z.ZodRawShape>(
  name: Name,
  fields: Fields
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes in this spike
): ZodModelCore<Name, Fields, z.ZodObject<Fields>, {}> {
  const insertSchema = z.object(fields)
  const docSchema = insertSchema.extend({
    _id: z.string(), // simplified for spike
    _creationTime: z.number()
  })

  function createModel(indexes: Record<string, readonly string[]>): any {
    return {
      name,
      fields,
      schema: {
        insert: insertSchema,
        doc: docSchema,
        docArray: z.array(docSchema)
      },
      indexes,
      index(indexName: string, indexFields: readonly string[]) {
        return createModel({
          ...indexes,
          [indexName]: [...indexFields, '_creationTime']
        })
      }
    }
  }

  return createModel({})
}

// ============================================================================
// Runtime Tests
// ============================================================================

describe('FieldPaths type-level spike', () => {
  it('defineZodModel creates model with schema shapes', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string()
    })

    expect(model.name).toBe('users')
    expect(model.indexes).toEqual({})
    expect(model.schema.insert).toBeDefined()
    expect(model.schema.doc).toBeDefined()
  })

  it('.index() accumulates index definitions', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string()
    })
      .index('byEmail', ['email'])
      .index('byName', ['name', '_creationTime'])

    expect(model.indexes).toEqual({
      byEmail: ['email', '_creationTime'],
      byName: ['name', '_creationTime', '_creationTime']
    })
  })

  it('.index() with zx.date() treats dates as leaves', () => {
    const model = defineZodModel('events', {
      title: z.string(),
      startDate: zx.date()
    }).index('byDate', ['startDate'])

    expect(model.indexes).toEqual({
      byDate: ['startDate', '_creationTime']
    })
  })

  it('.index() validates field paths at type level', () => {
    // This section documents what SHOULD and SHOULD NOT compile.
    // The type assertions above prove it; these runtime tests confirm the API works.

    const model = defineZodModel('patients', {
      clinicId: z.string(),
      name: z.string()
    })

    // These compile ✓
    model.index('byClinic', ['clinicId'])
    model.index('byName', ['name'])
    model.index('byClinicAndName', ['clinicId', 'name'])
    model.index('byCreation', ['_creationTime'])

    // These would NOT compile (uncomment to verify):
    // @ts-expect-error — 'bogus' is not a valid field path
    model.index('bad', ['bogus'])

    // @ts-expect-error — 'clinicid' (lowercase) is not a valid field path
    model.index('bad2', ['clinicid'])

    expect(true).toBe(true) // test passes if it compiles
  })

  it('.index() validates nested object paths', () => {
    const model = defineZodModel('locations', {
      name: z.string(),
      address: z.object({
        city: z.string(),
        state: z.string(),
        zip: z.number()
      })
    })

    // These compile ✓
    model.index('byCity', ['address.city'])
    model.index('byState', ['address.state'])
    model.index('byAddress', ['address'])

    // These would NOT compile:
    // @ts-expect-error — 'address.country' doesn't exist
    model.index('bad', ['address.country'])

    expect(true).toBe(true)
  })

  it('.index() validates custom field wire-format paths', () => {
    // Simulate a custom() codec using zodvexCodec directly
    const customString = zodvexCodec(
      z.object({
        value: z.string().nullable(),
        status: z.enum(['full', 'hidden']),
        __customField: z.string().optional(),
        reason: z.string().optional()
      }),
      z.custom<{ _brand: 'CustomField' }>(() => true),
      {
        decode: wire => ({ _brand: 'CustomField' as const, ...wire }),
        encode: _field => ({
          value: null,
          status: 'full' as const
        })
      }
    )

    const model = defineZodModel('patients', {
      clinicId: z.string(),
      email: customString
    })

    // These compile ✓ — wire-format paths into CustomWire structure
    model.index('byClinic', ['clinicId'])
    model.index('byEmailValue', ['email.value'])
    model.index('byEmailStatus', ['email.status'])

    // This would NOT compile:
    // @ts-expect-error — 'email.bogus' doesn't exist in CustomWire
    model.index('bad', ['email.bogus'])

    expect(true).toBe(true)
  })

  it('.index() with optional custom field preserves paths', () => {
    const customString = zodvexCodec(
      z.object({
        value: z.string().nullable(),
        status: z.enum(['full', 'hidden'])
      }),
      z.custom<{ _brand: 'CustomField' }>(() => true),
      {
        decode: _wire => ({ _brand: 'CustomField' as const }),
        encode: () => ({ value: null, status: 'full' as const })
      }
    )

    const model = defineZodModel('contacts', {
      name: z.string(),
      email: customString.optional(),
      phone: customString.nullable()
    })

    // These compile ✓ — optional/nullable don't block nested path access
    model.index('byEmailValue', ['email.value'])
    model.index('byPhoneValue', ['phone.value'])

    expect(true).toBe(true)
  })

  it('zx.id() fields are leaves (string wire format)', () => {
    const model = defineZodModel('events', {
      title: z.string(),
      organizerId: zx.id('users')
    })

    // Compiles ✓
    model.index('byOrganizer', ['organizerId'])

    // Would NOT compile — string has no sub-paths:
    // model.index('bad', ['organizerId.length'])

    expect(true).toBe(true)
  })
})

describe('FieldPaths edge cases', () => {
  it('handles z.record as wide string paths', () => {
    const model = defineZodModel('configs', {
      name: z.string(),
      metadata: z.record(z.string(), z.number())
    })

    // z.record input type is Record<string, number>
    // FieldPaths should accept any string sub-path (like Convex's VRecord)
    model.index('byMeta', ['metadata'])

    // Record fields are dynamic — any string key is valid at the type level
    // This SHOULD compile because Record<string, number> has string keys
    model.index('byMetaKey', ['metadata.anykey' as any]) // loose check for records

    expect(true).toBe(true)
  })

  it('handles deeply nested objects (2 levels)', () => {
    const model = defineZodModel('docs', {
      content: z.object({
        header: z.object({
          title: z.string(),
          subtitle: z.string().optional()
        }),
        body: z.string()
      })
    })

    // All depth levels compile ✓
    model.index('byTitle', ['content.header.title'])
    model.index('byBody', ['content.body'])
    model.index('byContent', ['content'])

    // Bad deep path:
    // @ts-expect-error — 'content.header.bogus' doesn't exist
    model.index('bad', ['content.header.bogus'])

    expect(true).toBe(true)
  })
})
