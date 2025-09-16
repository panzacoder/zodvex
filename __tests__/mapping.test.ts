import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { v } from 'convex/values'
import { zodToConvex, zodToConvexFields, analyzeZod } from '../src/mapping'

describe('analyzeZod', () => {
  it('identifies optional fields', () => {
    const schema = z.string().optional()
    const result = analyzeZod(schema)

    expect(result.optional).toBe(true)
    expect(result.nullable).toBe(false)
    expect(result.hasDefault).toBe(false)
  })

  it('identifies nullable fields', () => {
    const schema = z.string().nullable()
    const result = analyzeZod(schema)

    expect(result.optional).toBe(false)
    expect(result.nullable).toBe(true)
    expect(result.hasDefault).toBe(false)
  })

  it('identifies fields with defaults', () => {
    const schema = z.string().default('test')
    const result = analyzeZod(schema)

    expect(result.optional).toBe(true)
    expect(result.nullable).toBe(false)
    expect(result.hasDefault).toBe(true)
  })

  it('handles optional nullable fields', () => {
    const schema = z.string().optional().nullable()
    const result = analyzeZod(schema)

    expect(result.optional).toBe(true)
    expect(result.nullable).toBe(true)
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
    const schema = z.literal('test')
    const validator = zodToConvex(schema)
    expect(validator).toEqual(v.literal('test'))
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
    expect(validator).toEqual(v.any())
  })
})

describe('zodToConvexFields', () => {
  it('converts object shape to field validators', () => {
    const shape = {
      name: z.string(),
      age: z.number().optional(),
      active: z.boolean()
    }

    const validators = zodToConvexFields(shape)

    expect(validators).toEqual({
      name: v.string(),
      age: v.optional(v.float64()),
      active: v.boolean()
    })
  })

  it('handles nested objects', () => {
    const shape = {
      user: z.object({
        name: z.string(),
        email: z.string()
      })
    }

    const validators = zodToConvexFields(shape)

    expect(validators).toEqual({
      user: v.object({
        name: v.string(),
        email: v.string()
      })
    })
  })

  it('accepts ZodObject directly', () => {
    const schema = z.object({
      id: z.string(),
      count: z.number()
    })

    const validators = zodToConvexFields(schema)

    expect(validators).toEqual({
      id: v.string(),
      count: v.float64()
    })
  })

  it('handles mixed optional and nullable fields', () => {
    const shape = {
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      both: z.string().optional().nullable()
    }

    const validators = zodToConvexFields(shape)

    expect(validators).toEqual({
      required: v.string(),
      optional: v.optional(v.string()),
      nullable: v.union(v.string(), v.null()),
      both: v.optional(v.union(v.string(), v.null()))
    })
  })
})