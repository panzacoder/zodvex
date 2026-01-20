import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  assertUnionOptions,
  createUnionFromOptions,
  getUnionOptions,
  isZodUnion
} from '../src/tables'

describe('union helpers', () => {
  describe('isZodUnion', () => {
    it('returns true for ZodUnion', () => {
      const union = z.union([z.string(), z.number()])
      expect(isZodUnion(union)).toBe(true)
    })

    it('returns true for ZodDiscriminatedUnion', () => {
      const union = z.discriminatedUnion('type', [
        z.object({ type: z.literal('a'), value: z.string() }),
        z.object({ type: z.literal('b'), count: z.number() })
      ])
      expect(isZodUnion(union)).toBe(true)
    })

    it('returns false for ZodObject', () => {
      const obj = z.object({ name: z.string() })
      expect(isZodUnion(obj)).toBe(false)
    })

    it('returns false for ZodString', () => {
      expect(isZodUnion(z.string())).toBe(false)
    })

    it('returns false for ZodArray', () => {
      expect(isZodUnion(z.array(z.string()))).toBe(false)
    })
  })

  describe('getUnionOptions', () => {
    it('extracts options from ZodUnion', () => {
      const strSchema = z.string()
      const numSchema = z.number()
      const union = z.union([strSchema, numSchema])

      const options = getUnionOptions(union)

      expect(options).toHaveLength(2)
      expect(options[0]).toBe(strSchema)
      expect(options[1]).toBe(numSchema)
    })

    it('extracts options from ZodDiscriminatedUnion', () => {
      const optionA = z.object({ type: z.literal('a'), value: z.string() })
      const optionB = z.object({ type: z.literal('b'), count: z.number() })
      const union = z.discriminatedUnion('type', [optionA, optionB])

      const options = getUnionOptions(union)

      expect(options).toHaveLength(2)
      expect(options[0]).toBe(optionA)
      expect(options[1]).toBe(optionB)
    })

    it('extracts options from union with more than 2 variants', () => {
      const union = z.union([z.string(), z.number(), z.boolean(), z.null()])

      const options = getUnionOptions(union)

      expect(options).toHaveLength(4)
    })
  })

  describe('assertUnionOptions', () => {
    it('passes for array with 2 elements', () => {
      const options = [z.string(), z.number()]

      // Should not throw
      expect(() => assertUnionOptions(options)).not.toThrow()
    })

    it('passes for array with more than 2 elements', () => {
      const options = [z.string(), z.number(), z.boolean()]

      // Should not throw
      expect(() => assertUnionOptions(options)).not.toThrow()
    })

    it('throws for array with 1 element', () => {
      const options = [z.string()]

      expect(() => assertUnionOptions(options)).toThrow(
        'z.union() requires at least 2 options, but received 1'
      )
    })

    it('throws for empty array', () => {
      const options: z.ZodTypeAny[] = []

      expect(() => assertUnionOptions(options)).toThrow(
        'z.union() requires at least 2 options, but received 0'
      )
    })

    it('error message includes guidance about invalid schema', () => {
      const options = [z.string()]

      expect(() => assertUnionOptions(options)).toThrow(
        'invalid union schema was passed to zodTable()'
      )
    })
  })

  describe('createUnionFromOptions', () => {
    it('creates a union from valid options array', () => {
      const options = [z.string(), z.number()]

      const union = createUnionFromOptions(options)

      expect(union).toBeInstanceOf(z.ZodUnion)
      expect(union.options).toHaveLength(2)
    })

    it('created union validates correctly', () => {
      const options = [z.string(), z.number()]
      const union = createUnionFromOptions(options)

      expect(union.parse('hello')).toBe('hello')
      expect(union.parse(42)).toBe(42)
      expect(() => union.parse(true)).toThrow()
    })

    it('throws for array with fewer than 2 elements', () => {
      const options = [z.string()]

      expect(() => createUnionFromOptions(options)).toThrow('z.union() requires at least 2 options')
    })

    it('works with mapped/transformed options', () => {
      // Simulate what zodTable does - map over options to create partial variants
      // Use discriminated union to avoid ambiguous matching
      const originalOptions = [
        z.object({ kind: z.literal('a'), name: z.string(), age: z.number() }),
        z.object({ kind: z.literal('b'), title: z.string(), count: z.number() })
      ]

      const partialOptions = originalOptions.map(opt => opt.partial())
      const union = createUnionFromOptions(partialOptions)

      // Should accept partial objects (only kind is required for discrimination)
      expect(union.parse({ kind: 'a', name: 'test' })).toEqual({ kind: 'a', name: 'test' })
      expect(union.parse({ kind: 'b', title: 'hello' })).toEqual({ kind: 'b', title: 'hello' })
      // Empty object matches first variant since kind is also optional after partial()
      expect(union.parse({})).toEqual({})
    })
  })

  describe('integration with zodTable patterns', () => {
    it('handles the addSystemFields pattern', () => {
      // This simulates what addSystemFields does
      const union = z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ])

      expect(isZodUnion(union)).toBe(true)

      const options = getUnionOptions(union)
      const extendedOptions = options.map(variant => {
        if (variant instanceof z.ZodObject) {
          return variant.extend({
            _id: z.string(),
            _creationTime: z.number()
          })
        }
        return variant
      })

      const result = createUnionFromOptions(extendedOptions)

      // Verify the result has system fields
      const circleDoc = result.parse({
        kind: 'circle',
        r: 5,
        _id: 'abc123',
        _creationTime: Date.now()
      })
      expect(circleDoc._id).toBe('abc123')
    })

    it('handles the update schema pattern', () => {
      // This simulates what zodTable does for update schemas
      const union = z.union([
        z.object({ kind: z.literal('circle'), r: z.number() }),
        z.object({ kind: z.literal('rect'), w: z.number() })
      ])

      const options = getUnionOptions(union)
      const partialOptions = options.map(variant => {
        if (variant instanceof z.ZodObject) {
          return variant.partial()
        }
        return variant
      })

      const updateSchema = createUnionFromOptions(partialOptions)

      // Should accept partial updates
      expect(updateSchema.parse({ kind: 'circle' })).toEqual({ kind: 'circle' })
      expect(updateSchema.parse({})).toEqual({})
    })
  })
})
