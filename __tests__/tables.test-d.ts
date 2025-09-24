import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { v } from 'convex/values'
import type { Id } from 'convex/_generated/dataModel'
import { zodTable, zCrud, zodDoc } from '../src/tables'
import { zid } from '../src/ids'
import { query, mutation } from './_generated/server'
import type { VOptional, VArray, VId } from 'convex/values'

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
    expectTypeOf<Fields['optionalNullable']>().toMatchTypeOf<VOptional<v.ValidatorTypeFor<string | null>>>()
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

describe('zCrud type inference', () => {
  it('maintains type safety in CRUD operations', () => {
    const testShape = {
      name: z.string(),
      count: z.number().optional(),
      tags: z.array(z.string()).optional()
    }

    const TestTable = zodTable('test', testShape)

    // Type-only test - check that zCrud would accept the table
    type CrudType = typeof zCrud<
      'test',
      typeof testShape,
      typeof TestTable,
      typeof query,
      typeof mutation
    >

    // The type should be a function that returns CRUD operations
    expectTypeOf<CrudType>().toBeFunction()

    // Check the return type structure
    type CrudReturn = ReturnType<CrudType>
    expectTypeOf<CrudReturn>().toMatchTypeOf<{
      create: any
      read: any
      update: any
      destroy: any
      paginate: any
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