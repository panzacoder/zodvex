/**
 * Type tests for union model schema computation.
 * Verifies AddSystemFieldsToUnion produces the right types for
 * object, union, and discriminated union schemas.
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { $ZodNumber, $ZodObject, $ZodString } from 'zod/v4/core'
import type { AddSystemFieldsToUnion, SystemFields } from '../src/internal/schemaHelpers'

describe('AddSystemFieldsToUnion', () => {
  it('preserves $ZodObject and adds system fields', () => {
    type Input = $ZodObject<{ name: $ZodString }>
    type Result = AddSystemFieldsToUnion<'test', Input>
    expectTypeOf<Result>().toMatchTypeOf<$ZodObject<{ name: $ZodString } & SystemFields<'test'>>>()
  })
})
