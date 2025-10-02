import type { Id } from 'convex/_generated/dataModel'
import type { VArray, VId, VNumber, VOptional, VString } from 'convex/values'
import { v } from 'convex/values'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { zid } from '../src/ids'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvexFields } from '../src/mapping'

describe('ConvexValidatorFromZodFieldsAuto type preservation', () => {
  it('preserves specific ID types in optional fields', () => {
    const shape = {
      choreographers: z.array(zid('users')).optional(),
      talent: z.array(zid('dancers')).optional()
    }

    type Result = ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Should preserve specific ID types, not become generic
    expectTypeOf<Result['choreographers']>().toMatchTypeOf<VOptional<VArray<VId<'users'>>>>()
    expectTypeOf<Result['talent']>().toMatchTypeOf<VOptional<VArray<VId<'dancers'>>>>()
  })

  it('correctly identifies optional vs required fields', () => {
    const shape = {
      required: z.string(),
      optional: z.string().optional(),
      withDefault: z.string().default('hello'),
      nullable: z.string().nullable(),
      optionalNullable: z.string().optional().nullable()
    }

    type Result = ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Required field should not be optional
    expectTypeOf<Result['required']>().toMatchTypeOf<VString>()

    // Optional field should be VOptional
    expectTypeOf<Result['optional']>().toMatchTypeOf<VOptional<VString>>()

    // Default field should be optional in Convex
    expectTypeOf<Result['withDefault']>().toMatchTypeOf<VOptional<VString>>()

    // Nullable should be union with null, not optional
    expectTypeOf<Result['nullable']>().toMatchTypeOf<v.ValidatorTypeFor<string | null>>()

    // Optional nullable should be optional union
    expectTypeOf<Result['optionalNullable']>().toMatchTypeOf<
      VOptional<v.ValidatorTypeFor<string | null>>
    >()
  })

  it('handles nested object types', () => {
    const shape = {
      user: z.object({
        id: zid('users'),
        name: z.string()
      }),
      optionalUser: z
        .object({
          id: zid('users'),
          name: z.string()
        })
        .optional()
    }

    type Result = ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Nested objects should maintain their structure
    expectTypeOf<Result['user']>().toMatchTypeOf<
      v.ValidatorTypeFor<{
        id: Id<'users'>
        name: string
      }>
    >()

    // Optional nested objects should be wrapped in VOptional
    expectTypeOf<Result['optionalUser']>().toMatchTypeOf<
      VOptional<
        v.ValidatorTypeFor<{
          id: Id<'users'>
          name: string
        }>
      >
    >()
  })
})

describe('zodToConvexFields type inference', () => {
  it('returns properly typed validator fields', () => {
    const shape = {
      name: z.string(),
      age: z.number().optional(),
      userId: zid('users')
    }

    const result = zodToConvexFields(shape)

    // The result should have the correct type
    type ResultType = typeof result
    type Expected = ConvexValidatorFromZodFieldsAuto<typeof shape>

    expectTypeOf<ResultType>().toEqualTypeOf<Expected>()

    // Individual fields should be correctly typed
    expectTypeOf(result.name).toMatchTypeOf<VString>()
    expectTypeOf(result.age).toMatchTypeOf<VOptional<VNumber>>()
    expectTypeOf(result.userId).toMatchTypeOf<VId<'users'>>()
  })

  it('preserves array types with specific IDs', () => {
    const shape = {
      userIds: z.array(zid('users')),
      optionalUserIds: z.array(zid('users')).optional(),
      tags: z.array(z.string())
    }

    const result = zodToConvexFields(shape)

    type ResultType = typeof result

    // Arrays of IDs should preserve their specific table types
    expectTypeOf<ResultType['userIds']>().toMatchTypeOf<VArray<VId<'users'>>>()
    expectTypeOf<ResultType['optionalUserIds']>().toMatchTypeOf<VOptional<VArray<VId<'users'>>>>()
    expectTypeOf<ResultType['tags']>().toMatchTypeOf<VArray<VString>>()
  })

  it('handles union types correctly', () => {
    const shape = {
      status: z.union([z.literal('active'), z.literal('inactive')]),
      nullableStatus: z.union([z.literal('active'), z.literal('inactive')]).nullable()
    }

    const result = zodToConvexFields(shape)

    // Union types should be preserved
    expectTypeOf(result.status).toMatchTypeOf<v.ValidatorTypeFor<'active' | 'inactive'>>()
    expectTypeOf(result.nullableStatus).toMatchTypeOf<
      v.ValidatorTypeFor<'active' | 'inactive' | null>
    >()
  })
})

describe('Complex type scenarios', () => {
  it('handles deeply nested optional arrays of IDs', () => {
    const shape = {
      teams: z
        .array(
          z.object({
            name: z.string(),
            memberIds: z.array(zid('users')).optional()
          })
        )
        .optional()
    }

    type Result = ConvexValidatorFromZodFieldsAuto<typeof shape>

    // The nested structure should preserve ID types
    expectTypeOf<Result['teams']>().toMatchTypeOf<
      VOptional<
        VArray<
          v.ValidatorTypeFor<{
            name: string
            memberIds?: Id<'users'>[]
          }>
        >
      >
    >()
  })

  it('preserves enum types', () => {
    const shape = {
      role: z.enum(['admin', 'user', 'guest']),
      optionalRole: z.enum(['admin', 'user', 'guest']).optional()
    }

    type Result = ConvexValidatorFromZodFieldsAuto<typeof shape>

    expectTypeOf<Result['role']>().toMatchTypeOf<v.ValidatorTypeFor<'admin' | 'user' | 'guest'>>()
    expectTypeOf<Result['optionalRole']>().toMatchTypeOf<
      VOptional<v.ValidatorTypeFor<'admin' | 'user' | 'guest'>>
    >()
  })

  it('handles literal types', () => {
    const shape = {
      type: z.literal('user'),
      version: z.literal(1),
      optionalFlag: z.literal(true).optional()
    }

    type Result = ConvexValidatorFromZodFieldsAuto<typeof shape>

    expectTypeOf<Result['type']>().toMatchTypeOf<v.ValidatorTypeFor<'user'>>()
    expectTypeOf<Result['version']>().toMatchTypeOf<v.ValidatorTypeFor<1>>()
    expectTypeOf<Result['optionalFlag']>().toMatchTypeOf<VOptional<v.ValidatorTypeFor<true>>>()
  })
})
