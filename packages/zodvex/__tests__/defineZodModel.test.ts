/**
 * Tests for defineZodModel — client-safe model definitions with type-safe indexes
 *
 * Compile-time type assertions validate FieldPaths extraction.
 * Runtime tests validate the defineZodModel API and index accumulation.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { zodvexCodec } from '../src/internal/codec'
import { readMeta, type ZodvexModelMeta } from '../src/internal/meta'
import { defineZodModel, type FieldPaths, type ModelFieldPaths } from '../src/internal/model'
import type { ZodvexCodec } from '../src/internal/types'
import { zx } from '../src/internal/zx'

// ============================================================================
// Type-Level Assertions (compile-time tests)
// ============================================================================

type AssertAssignable<A, B> = A extends B ? true : false
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// --- Flat object ---

type FlatSchema = z.ZodObject<{
  name: z.ZodString
  age: z.ZodNumber
  active: z.ZodBoolean
}>

type FlatPaths = FieldPaths<z.input<FlatSchema>>
type _flat1 = AssertEqual<FlatPaths, 'name' | 'age' | 'active'>
const _flatCheck: _flat1 = true

// --- Nested object ---

type NestedSchema = z.ZodObject<{
  name: z.ZodString
  address: z.ZodObject<{
    city: z.ZodString
    zip: z.ZodNumber
  }>
}>

type NestedPaths = FieldPaths<z.input<NestedSchema>>
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

// --- Optional fields ---

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
type _opt1 = AssertAssignable<'address.city', OptionalPaths>
const _optCheck1: _opt1 = true

// --- zx.date() codec (wire format = number, leaf) ---

type ZxDate = ZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>
type DateSchema = z.ZodObject<{
  title: z.ZodString
  createdAt: ZxDate
}>

type DatePaths = FieldPaths<z.input<DateSchema>>
type _date1 = AssertEqual<DatePaths, 'title' | 'createdAt'>
const _dateCheck: _date1 = true

// --- Custom field codec (wire format = object, nested paths) ---

// biome-ignore lint/correctness/noUnusedVariables: documents the wire shape for this test section
type CustomWire<T> = {
  value: T | null
  status: 'full' | 'hidden'
  __customField?: string
  reason?: string
}

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

// --- ModelFieldPaths adds _creationTime ---

type ModelPaths = ModelFieldPaths<CustomFieldSchema>
type _model1 = AssertAssignable<'_creationTime', ModelPaths>
type _model2 = AssertAssignable<'clinicId', ModelPaths>
const _modelCheck1: _model1 = true
const _modelCheck2: _model2 = true

// --- Union type ---

type UnionSchema = z.ZodObject<{
  data: z.ZodUnion<
    [
      z.ZodObject<{ kind: z.ZodLiteral<'a'>; x: z.ZodNumber }>,
      z.ZodObject<{ kind: z.ZodLiteral<'b'>; y: z.ZodString }>
    ]
  >
}>

type UnionPaths = FieldPaths<z.input<UnionSchema>>
type _union1 = AssertAssignable<'data', UnionPaths>
type _union2 = AssertAssignable<'data.kind', UnionPaths>
type _union3 = AssertAssignable<'data.x', UnionPaths>
type _union4 = AssertAssignable<'data.y', UnionPaths>
const _unionCheck1: _union1 = true
const _unionCheck2: _union2 = true
const _unionCheck3: _union3 = true
const _unionCheck4: _union4 = true

// --- Array fields are leaves ---

type ArraySchema = z.ZodObject<{
  tags: z.ZodArray<z.ZodString>
  items: z.ZodArray<z.ZodObject<{ name: z.ZodString }>>
}>

type ArrayPaths = FieldPaths<z.input<ArraySchema>>
type _arr1 = AssertEqual<ArrayPaths, 'tags' | 'items'>
const _arrCheck: _arr1 = true

// --- Nullable nested object ---

type NullableSchema = z.ZodObject<{
  profile: z.ZodNullable<
    z.ZodObject<{
      bio: z.ZodString
      avatar: z.ZodOptional<z.ZodString>
    }>
  >
}>

type NullablePaths = FieldPaths<z.input<NullableSchema>>
type _null1 = AssertAssignable<'profile', NullablePaths>
type _null2 = AssertAssignable<'profile.bio', NullablePaths>
type _null3 = AssertAssignable<'profile.avatar', NullablePaths>
const _nullCheck1: _null1 = true
const _nullCheck2: _null2 = true
const _nullCheck3: _null3 = true

// ============================================================================
// Runtime Tests — defineZodModel API
// ============================================================================

describe('defineZodModel', () => {
  it('creates model with name and schema shapes', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string()
    })

    expect(model.name).toBe('users')
    expect(model.fields).toBeDefined()
    expect(model.indexes).toEqual({})
    expect(model.searchIndexes).toEqual({})
    expect(model.vectorIndexes).toEqual({})

    // Schema shapes exist
    expect(model.schema.insert).toBeDefined()
    expect(model.schema.doc).toBeDefined()
    expect(model.schema.update).toBeDefined()
    expect(model.schema.docArray).toBeDefined()
  })

  it('schema.insert validates user fields only', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      age: z.number()
    })

    const result = model.schema.insert.safeParse({ name: 'Alice', age: 30 })
    expect(result.success).toBe(true)

    const bad = model.schema.insert.safeParse({ name: 'Alice' })
    expect(bad.success).toBe(false)
  })

  it('schema.doc validates user fields + system fields', () => {
    const model = defineZodModel('users', {
      name: z.string()
    })

    const result = model.schema.doc.safeParse({
      name: 'Alice',
      _id: 'abc123',
      _creationTime: 1234567890
    })
    expect(result.success).toBe(true)

    // Missing system fields
    const bad = model.schema.doc.safeParse({ name: 'Alice' })
    expect(bad.success).toBe(false)
  })

  it('schema.update requires _id, user fields are partial', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      age: z.number()
    })

    // _id required, user fields optional
    const result = model.schema.update.safeParse({ _id: 'abc123' })
    expect(result.success).toBe(true)

    // Partial user fields OK
    const partial = model.schema.update.safeParse({ _id: 'abc123', name: 'Bob' })
    expect(partial.success).toBe(true)

    // Missing _id fails
    const bad = model.schema.update.safeParse({ name: 'Bob' })
    expect(bad.success).toBe(false)
  })

  it('schema.update does not double-wrap already-optional fields', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string().optional(), // already optional
      age: z.number()
    })

    // Get the update schema's shape
    const updateShape = (model.schema.update as z.ZodObject<any>).shape

    // email was already optional — should be ZodOptional, not ZodOptional<ZodOptional>
    const emailField = updateShape.email
    expect(emailField).toBeInstanceOf(z.ZodOptional)

    // The inner type should be ZodString, not another ZodOptional
    const inner = (emailField as any)._zod.def.innerType
    expect(inner).toBeInstanceOf(z.ZodString)
    expect(inner).not.toBeInstanceOf(z.ZodOptional)
  })

  it('schema.docArray validates array of docs', () => {
    const model = defineZodModel('users', {
      name: z.string()
    })

    const result = model.schema.docArray.safeParse([
      { name: 'Alice', _id: 'a', _creationTime: 1 },
      { name: 'Bob', _id: 'b', _creationTime: 2 }
    ])
    expect(result.success).toBe(true)
  })

  it('schema.paginatedDoc validates paginated response shape', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
      done: z.boolean()
    })

    expect(model.schema.paginatedDoc).toBeDefined()

    const result = model.schema.paginatedDoc.safeParse({
      page: [
        { title: 'Task 1', done: false, _id: 'a', _creationTime: 1 },
        { title: 'Task 2', done: true, _id: 'b', _creationTime: 2 }
      ],
      isDone: false,
      continueCursor: 'cursor123'
    })
    expect(result.success).toBe(true)
  })

  it('schema.paginatedDoc rejects invalid page items', () => {
    const model = defineZodModel('tasks', {
      title: z.string()
    })

    const result = model.schema.paginatedDoc.safeParse({
      page: [{ badField: true }],
      isDone: false,
      continueCursor: null
    })
    expect(result.success).toBe(false)
  })

  it('schema.paginatedDoc accepts valid paginated response', () => {
    const model = defineZodModel('tasks', {
      title: z.string()
    })

    const result = model.schema.paginatedDoc.safeParse({
      page: [],
      isDone: true,
      continueCursor: 'cursor_value'
    })
    expect(result.success).toBe(true)
  })
})

describe('defineZodModel .index()', () => {
  it('accumulates index definitions', () => {
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

  it('validates field paths at type level', () => {
    const model = defineZodModel('patients', {
      clinicId: z.string(),
      name: z.string()
    })

    // These compile
    model.index('byClinic', ['clinicId'])
    model.index('byName', ['name'])
    model.index('byClinicAndName', ['clinicId', 'name'])
    model.index('byCreation', ['_creationTime'])

    // These would NOT compile:
    // @ts-expect-error — 'bogus' is not a valid field path
    model.index('bad', ['bogus'])
    // @ts-expect-error — 'clinicid' (lowercase) is not a valid field path
    model.index('bad2', ['clinicid'])

    expect(true).toBe(true)
  })

  it('validates nested object paths', () => {
    const model = defineZodModel('locations', {
      name: z.string(),
      address: z.object({
        city: z.string(),
        state: z.string(),
        zip: z.number()
      })
    })

    model.index('byCity', ['address.city'])
    model.index('byState', ['address.state'])
    model.index('byAddress', ['address'])

    // @ts-expect-error — 'address.country' doesn't exist
    model.index('bad', ['address.country'])

    expect(true).toBe(true)
  })

  it('validates custom field wire-format paths', () => {
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

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const model = defineZodModel('patients', {
      clinicId: z.string(),
      email: customString
    })

    // Wire-format paths into CustomWire structure
    model.index('byClinic', ['clinicId'])
    model.index('byEmailValue', ['email.value'])
    model.index('byEmailStatus', ['email.status'])

    // @ts-expect-error — 'email.bogus' doesn't exist in CustomWire
    model.index('bad', ['email.bogus'])

    expect(true).toBe(true)
    warnSpy.mockRestore()
  })

  it('handles optional custom fields', () => {
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

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const model = defineZodModel('contacts', {
      name: z.string(),
      email: customString.optional(),
      phone: customString.nullable()
    })

    // Optional/nullable don't block nested path access
    model.index('byEmailValue', ['email.value'])
    model.index('byPhoneValue', ['phone.value'])

    expect(true).toBe(true)
    warnSpy.mockRestore()
  })

  it('does not warn when indexing a codec field (encoding is now automatic)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    defineZodModel('events', {
      title: z.string(),
      startDate: zx.date()
    }).index('byDate', ['startDate'])

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not warn when indexing a dot-path into a codec field', () => {
    const customString = zodvexCodec(
      z.object({
        value: z.string().nullable(),
        status: z.enum(['full', 'hidden'])
      }),
      z.custom<{ _brand: 'CustomField' }>(() => true),
      {
        decode: (_wire: any) => ({ _brand: 'CustomField' as const }),
        encode: () => ({ value: null, status: 'full' as const })
      }
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    defineZodModel('patients', {
      clinicId: z.string(),
      email: customString
    })
      .index('byEmail', ['email'])
      .index('byEmailValue', ['email.value'])

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not warn for non-codec fields', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    defineZodModel('users', {
      name: z.string(),
      email: z.string(),
      address: z.object({ city: z.string() })
    })
      .index('byEmail', ['email'])
      .index('byCity', ['address.city'])

    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('treats zx.date() as leaf', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = defineZodModel('events', {
      title: z.string(),
      startDate: zx.date()
    }).index('byDate', ['startDate'])

    expect(model.indexes).toEqual({
      byDate: ['startDate', '_creationTime']
    })
    warnSpy.mockRestore()
  })

  it('treats zx.id() as leaf', () => {
    const model = defineZodModel('events', {
      title: z.string(),
      organizerId: zx.id('users')
    })

    model.index('byOrganizer', ['organizerId'])
    expect(true).toBe(true)
  })

  it('handles deeply nested objects', () => {
    const model = defineZodModel('docs', {
      content: z.object({
        header: z.object({
          title: z.string(),
          subtitle: z.string().optional()
        }),
        body: z.string()
      })
    })

    model.index('byTitle', ['content.header.title'])
    model.index('byBody', ['content.body'])
    model.index('byContent', ['content'])

    // @ts-expect-error — 'content.header.bogus' doesn't exist
    model.index('bad', ['content.header.bogus'])

    expect(true).toBe(true)
  })
})

describe('defineZodModel .searchIndex() / .vectorIndex()', () => {
  it('accumulates search indexes', () => {
    const model = defineZodModel('docs', {
      title: z.string(),
      body: z.string()
    }).searchIndex('search_body', {
      searchField: 'body',
      filterFields: ['title']
    })

    expect(model.searchIndexes).toEqual({
      search_body: { searchField: 'body', filterFields: ['title'] }
    })
  })

  it('accumulates vector indexes', () => {
    const model = defineZodModel('docs', {
      title: z.string(),
      embedding: z.array(z.number())
    }).vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 1536,
      filterFields: ['title']
    })

    expect(model.vectorIndexes).toEqual({
      by_embedding: { vectorField: 'embedding', dimensions: 1536, filterFields: ['title'] }
    })
  })

  it('chains all index types together', () => {
    const model = defineZodModel('docs', {
      title: z.string(),
      body: z.string(),
      embedding: z.array(z.number())
    })
      .index('byTitle', ['title'])
      .searchIndex('search_body', { searchField: 'body' })
      .vectorIndex('by_embedding', { vectorField: 'embedding', dimensions: 1536 })

    expect(Object.keys(model.indexes)).toEqual(['byTitle'])
    expect(Object.keys(model.searchIndexes)).toEqual(['search_body'])
    expect(Object.keys(model.vectorIndexes)).toEqual(['by_embedding'])
  })
})

describe('defineZodModel __zodvexMeta', () => {
  it('model has metadata with type model, correct tableName, all 4 schemas', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string()
    })

    const meta = readMeta(model)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('model')

    const mmeta = meta as ZodvexModelMeta
    expect(mmeta.tableName).toBe('users')
    expect(mmeta.definitionSource).toBe('shape')
    expect(mmeta.schemas.doc).toBe(model.schema.doc)
    expect(mmeta.schemas.insert).toBe(model.schema.insert)
    expect(mmeta.schemas.update).toBe(model.schema.update)
    expect(mmeta.schemas.docArray).toBe(model.schema.docArray)
  })

  it('metadata preserved through .index() chaining', () => {
    const model = defineZodModel('posts', {
      title: z.string(),
      authorId: z.string()
    })
      .index('byAuthor', ['authorId'])
      .index('byTitle', ['title'])

    const meta = readMeta(model)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('model')

    const mmeta = meta as ZodvexModelMeta
    expect(mmeta.tableName).toBe('posts')
    expect(mmeta.schemas.doc).toBeDefined()
    expect(mmeta.schemas.insert).toBeDefined()
  })

  it('metadata preserved through .searchIndex() and .vectorIndex() chaining', () => {
    const model = defineZodModel('docs', {
      body: z.string(),
      embedding: z.array(z.number())
    })
      .searchIndex('search_body', { searchField: 'body' })
      .vectorIndex('by_embedding', { vectorField: 'embedding', dimensions: 1536 })

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.type).toBe('model')
    expect(meta.tableName).toBe('docs')
  })
})
