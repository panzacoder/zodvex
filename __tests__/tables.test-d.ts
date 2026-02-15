import type { Id } from 'convex/_generated/dataModel'
import type { VArray, VId, VOptional } from 'convex/values'
import { v } from 'convex/values'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { zid } from '../src/ids'
import { zodDoc, zodTable } from '../src/tables'
import { zx } from '../src/zx'
import { mutation, query } from './_generated/server'

describe('zodTable type inference', () => {
  it('preserves specific field types for optional arrays of IDs', () => {
    const testShape = {
      choreographers: z.array(zid('users')).optional(),
      talent: z.array(zid('users')).optional()
    }

    const TestTable = zodTable('test', testShape)

    // The table should have the shape attached
    expectTypeOf(TestTable.shape).toEqualTypeOf(testShape)

    // The validator fields should preserve specific types
    type Fields = typeof TestTable.table.validator.fields

    // These should be optional arrays of specific ID types, not generic
    expectTypeOf<Fields['choreographers']>().toMatchTypeOf<VOptional<VArray<VId<'users'>>>>()
    expectTypeOf<Fields['talent']>().toMatchTypeOf<VOptional<VArray<VId<'users'>>>>()
  })

  it('preserves required field types', () => {
    const testShape = {
      name: z.string(),
      userId: zid('users'),
      count: z.number()
    }

    const TestTable = zodTable('test', testShape)

    type Fields = typeof TestTable.table.validator.fields

    // Required fields should not be wrapped in VOptional
    expectTypeOf<Fields['name']>().toMatchTypeOf<v.ValidatorTypeFor<string>>()
    expectTypeOf<Fields['userId']>().toMatchTypeOf<VId<'users'>>()
    expectTypeOf<Fields['count']>().toMatchTypeOf<v.ValidatorTypeFor<number>>()
  })

  it('handles mixed optional and required fields', () => {
    const testShape = {
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      optionalNullable: z.string().optional().nullable()
    }

    const TestTable = zodTable('test', testShape)

    type Fields = typeof TestTable.table.validator.fields

    // Check each field maintains its correct optionality
    expectTypeOf<Fields['required']>().toMatchTypeOf<v.ValidatorTypeFor<string>>()
    expectTypeOf<Fields['optional']>().toMatchTypeOf<VOptional<v.ValidatorTypeFor<string>>>()
    expectTypeOf<Fields['nullable']>().toMatchTypeOf<v.ValidatorTypeFor<string | null>>()
    expectTypeOf<Fields['optionalNullable']>().toMatchTypeOf<
      VOptional<v.ValidatorTypeFor<string | null>>
    >()
  })

  it('provides zDoc helper with proper types', () => {
    const testShape = {
      name: z.string(),
      userId: zid('users').optional()
    }

    const TestTable = zodTable('test', testShape)

    // zDoc should be attached and properly typed
    expectTypeOf(TestTable.zDoc).not.toBeNever()

    // The doc schema should include system fields
    type DocType = z.infer<typeof TestTable.zDoc>
    expectTypeOf<DocType>().toMatchTypeOf<{
      _id: Id<'test'>
      _creationTime: number
      name: string
      userId?: Id<'users'>
    }>()
  })
})

describe('zodTable type inference - additional', () => {
  it('maintains proper shape property', () => {
    const testShape = {
      name: z.string(),
      count: z.number().optional(),
      tags: z.array(z.string()).optional()
    }

    const TestTable = zodTable('test', testShape)

    // Type-only test - check that shape is properly attached
    expectTypeOf(TestTable.shape).toEqualTypeOf(testShape)

    // Check that zDoc is properly typed
    type DocType = z.infer<typeof TestTable.zDoc>
    expectTypeOf<DocType>().toMatchTypeOf<{
      name: string
      count?: number
      tags?: string[]
      _id: Id<'test'>
      _creationTime: number
    }>()
  })

  it('preserves argument types in create operation', () => {
    const testShape = {
      choreographers: z.array(zid('users')).optional(),
      name: z.string()
    }

    const TestTable = zodTable('test', testShape)

    // The shape should be accessible for type checking
    type ShapeType = typeof TestTable.shape
    type InferredArgs = z.infer<z.ZodObject<ShapeType>>

    expectTypeOf<InferredArgs>().toMatchTypeOf<{
      name: string
      choreographers?: Id<'users'>[]
    }>()
  })
})

describe('zodDoc helper', () => {
  it('creates proper document schema with system fields', () => {
    const testShape = {
      title: z.string(),
      authorId: zid('users'),
      tags: z.array(z.string()).optional()
    }

    const docSchema = zodDoc('posts', z.object(testShape))

    type DocType = z.infer<typeof docSchema>

    expectTypeOf<DocType>().toMatchTypeOf<{
      _id: Id<'posts'>
      _creationTime: number
      title: string
      authorId: Id<'users'>
      tags?: string[]
    }>()
  })

  it('preserves optional fields in document schema', () => {
    const testShape = {
      required: z.string(),
      optional: z.number().optional()
    }

    const docSchema = zodDoc('test', z.object(testShape))

    type DocType = z.infer<typeof docSchema>

    // Optional should remain optional in doc type
    expectTypeOf<DocType['optional']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<DocType['required']>().toEqualTypeOf<string>()
  })
})

describe('zodTable doc types with codecs (issue #37)', () => {
  it('doc type uses wire format for zx.date() fields', () => {
    const Events = zodTable('events', {
      name: z.string(),
      createdAt: zx.date()
    })

    type DocType = z.infer<typeof Events.schema.doc>

    // createdAt should be number (wire format), not Date (runtime format)
    expectTypeOf<DocType['createdAt']>().toEqualTypeOf<number>()
    // Other fields should be unchanged
    expectTypeOf<DocType['name']>().toEqualTypeOf<string>()
    // System fields should be present
    expectTypeOf<DocType['_creationTime']>().toEqualTypeOf<number>()
  })

  it('docArray type uses wire format for zx.date() fields', () => {
    const Events = zodTable('events', {
      name: z.string(),
      createdAt: zx.date()
    })

    type DocArrayType = z.infer<typeof Events.schema.docArray>

    // Array elements should have wire-format dates
    expectTypeOf<DocArrayType[number]['createdAt']>().toEqualTypeOf<number>()
  })

  it('handles optional zx.date() in doc type', () => {
    const Events = zodTable('events', {
      name: z.string(),
      updatedAt: zx.date().optional()
    })

    type DocType = z.infer<typeof Events.schema.doc>

    // Optional date should be number | undefined in wire format
    expectTypeOf<DocType['updatedAt']>().toEqualTypeOf<number | undefined>()
  })

  it('handles nullable zx.date() in doc type', () => {
    const Events = zodTable('events', {
      name: z.string(),
      deletedAt: zx.date().nullable()
    })

    type DocType = z.infer<typeof Events.schema.doc>

    // Nullable date should be number | null in wire format
    expectTypeOf<DocType['deletedAt']>().toEqualTypeOf<number | null>()
  })

  it('base/insert types preserve codec runtime types', () => {
    const Events = zodTable('events', {
      name: z.string(),
      createdAt: zx.date()
    })

    type BaseType = z.infer<typeof Events.schema.base>

    // base schema should use runtime types (Date) for codec fields
    // because it represents data before encoding for Convex
    expectTypeOf<BaseType['createdAt']>().toEqualTypeOf<Date>()
  })

  it('zodDoc uses wire format for codec fields', () => {
    const docSchema = zodDoc(
      'events',
      z.object({
        name: z.string(),
        createdAt: zx.date()
      })
    )

    type DocType = z.infer<typeof docSchema>

    expectTypeOf<DocType['createdAt']>().toEqualTypeOf<number>()
    expectTypeOf<DocType['name']>().toEqualTypeOf<string>()
  })
})
