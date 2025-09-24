import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { v } from 'convex/values'
import { zodToConvex, zodToConvexFields } from '../src/mapping'

describe('zodToConvex optional/nullable handling', () => {
  it('handles optional fields correctly', () => {
    const schema = z.string().optional()
    const validator = zodToConvex(schema)
    // Should be v.optional(v.string())
    expect(validator).toEqual(v.optional(v.string()))
  })

  it('handles nullable fields correctly', () => {
    const schema = z.string().nullable()
    const validator = zodToConvex(schema)
    // Should be v.union(v.string(), v.null())
    expect(validator).toEqual(v.union(v.string(), v.null()))
  })

  it('handles fields with defaults as optional', () => {
    const schema = z.string().default('hello')
    const validator = zodToConvex(schema)
    // Default fields should be optional in Convex
    expect(validator.isOptional).toEqual('optional')
    expect(validator.kind).toEqual('string')
    // Should preserve default value as metadata
    expect((validator as any)._zodDefault).toEqual('hello')
  })

  it('handles optional nullable fields correctly', () => {
    const schema = z.string().optional().nullable()
    const validator = zodToConvex(schema)
    // Should be v.optional(v.union(v.string(), v.null()))
    expect(validator).toEqual(v.optional(v.union(v.string(), v.null())))
  })

  it('handles nullable optional fields correctly', () => {
    const schema = z.string().nullable().optional()
    const validator = zodToConvex(schema)
    // The order matters - nullable then optional results in optional(union)
    expect(validator).toEqual(v.optional(v.union(v.string(), v.null())))
  })
})

describe('zodToConvex', () => {
  it('maps basic string', () => {
    const schema = z.string()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.string())
  })

  it('maps optional string correctly', () => {
    const schema = z.string().optional()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.optional(v.string()))
  })

  it('maps nullable string correctly', () => {
    const schema = z.string().nullable()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.union(v.string(), v.null()))
  })

  it('maps optional nullable string correctly', () => {
    const schema = z.string().optional().nullable()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.optional(v.union(v.string(), v.null())))
  })

  it('maps numbers to float64', () => {
    const schema = z.number()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.float64())
  })

  it('maps bigint to int64', () => {
    const schema = z.bigint()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.int64())
  })

  it('maps boolean', () => {
    const schema = z.boolean()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.boolean())
  })

  it('maps arrays', () => {
    const schema = z.array(z.string())
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.array(v.string()))
  })

  it('maps optional arrays', () => {
    const schema = z.array(z.string()).optional()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.optional(v.array(v.string())))
  })

  it('maps records', () => {
    const schema = z.record(z.string())
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.record(v.string(), v.string()))
  })

  it('maps dates as float64', () => {
    const schema = z.date()
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.float64())
  })

  it('maps literals', () => {
    const schema = z.literal('hello')
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.literal('hello'))
  })

  it('maps unions', () => {
    const schema = z.union([z.string(), z.number()])
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.union(v.string(), v.float64()))
  })

  it('maps enums', () => {
    const schema = z.enum(['a', 'b', 'c'])
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.union(v.literal('a'), v.literal('b'), v.literal('c')))
  })

  it('falls back to any for unsupported types', () => {
    const schema = z.string().transform(s => s.toUpperCase())
    const validator = zodToConvex(schema)
    // Transform schemas now map to v.any() since we can't access inner schema
    expect(validator).toEqual(v.any())
  })
})

describe('zodToConvexFields', () => {
  it('converts object shape to field validators', () => {
    const shape = {
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
      isActive: z.boolean().optional()
    }

    const validators = zodToConvexFields(shape)

    expect(validators).toEqual({
      name: v.string(),
      age: v.float64(),
      email: v.string(),
      isActive: v.optional(v.boolean())
    })
  })

  it('handles nested objects', () => {
    const shape = {
      user: z.object({
        name: z.string(),
        profile: z.object({
          bio: z.string().optional()
        })
      })
    }

    const validators = zodToConvexFields(shape)

    expect(validators).toEqual({
      user: v.object({
        name: v.string(),
        profile: v.object({
          bio: v.optional(v.string())
        })
      })
    })
  })

  it('accepts ZodObject directly', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional()
    })

    const validators = zodToConvexFields(schema)

    expect(validators).toEqual({
      name: v.string(),
      age: v.optional(v.float64())
    })
  })

  it('handles mixed optional and nullable fields', () => {
    const shape = {
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      optionalNullable: z.string().optional().nullable()
    }

    const validators = zodToConvexFields(shape)

    expect(validators).toEqual({
      required: v.string(),
      optional: v.optional(v.string()),
      nullable: v.union(v.string(), v.null()),
      optionalNullable: v.optional(v.union(v.string(), v.null()))
    })
  })
})