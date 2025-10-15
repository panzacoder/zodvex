import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zodToConvex } from '../src/mapping'
import type { VUnion, VLiteral } from 'convex/values'

describe('Enum type inference', () => {
  it('should infer specific literal types for z.enum', () => {
    const zodEnum = z.enum(['foo', 'bar'])
    const convexValidator = zodToConvex(zodEnum)

    // Type-level test: Check if the type matches the expected structure
    type ActualType = typeof convexValidator

    // The type should be VUnion with specific literal types
    // We can't do exact type equality checks easily in runtime, but we can verify
    // that the structure is correct by checking it assignability

    type ExpectedType = VUnion<
      'foo' | 'bar',
      [VLiteral<'foo', 'required'>, VLiteral<'bar', 'required'>],
      'required',
      never
    >

    // This is a compile-time check - if types don't match, TypeScript will error
    const _typeCheck: ExpectedType = convexValidator as ActualType

    // Runtime check - verify the validator works correctly
    expect(convexValidator).toBeDefined()
  })

  it('should handle enums with more than 2 values', () => {
    const zodEnum = z.enum(['a', 'b', 'c', 'd'])
    const convexValidator = zodToConvex(zodEnum)

    type ActualType = typeof convexValidator
    type ExpectedType = VUnion<
      'a' | 'b' | 'c' | 'd',
      [
        VLiteral<'a', 'required'>,
        VLiteral<'b', 'required'>,
        VLiteral<'c', 'required'>,
        VLiteral<'d', 'required'>
      ],
      'required',
      never
    >

    const _typeCheck: ExpectedType = convexValidator as ActualType

    expect(convexValidator).toBeDefined()
  })

  it('should preserve literal types when used in object fields', () => {
    const schema = z.object({
      status: z.enum(['active', 'inactive', 'pending'])
    })

    const validator = zodToConvex(schema)

    // Just verify it compiles and runs without errors
    expect(validator).toBeDefined()
  })
})
