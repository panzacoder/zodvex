import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
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

  it('extracts input schema from transforms', () => {
    const schema = z.string().transform(s => s.toUpperCase())
    const validator = zodToConvex(schema)
    // Transform schemas now correctly extract the input schema (z.string())
    // This allows Convex validation while warning that encoding won't work
    expect(validator).toEqual(v.string())
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

describe('zodToConvex native z.codec() handling', () => {
  it('handles basic codec - uses input (wire) schema for validation', () => {
    // Create a codec that transforms between wire format and runtime format
    const wireSchema = z.object({ value: z.string() })
    const fieldSchema = z.string()
    const codec = z.codec(wireSchema, fieldSchema, {
      encode: (val: string) => ({ value: val }),
      decode: (wire: { value: string }) => wire.value
    })

    const validator = zodToConvex(codec)

    // The Convex validator should be based on the wire schema (input type)
    expect(validator).toEqual(v.object({ value: v.string() }))
  })

  it('handles codec with nullable inner value', () => {
    const wireSchema = z.object({
      value: z.string().nullable(),
      metadata: z.object({ timestamp: z.number() })
    })
    const fieldSchema = z.string().nullable()
    const codec = z.codec(wireSchema, fieldSchema, {
      encode: (val: string | null) => ({
        value: val,
        metadata: { timestamp: Date.now() }
      }),
      decode: (wire: { value: string | null }) => wire.value
    })

    const validator = zodToConvex(codec)

    // Should create validator for the wire schema
    expect(validator).toEqual(
      v.object({
        value: v.union(v.string(), v.null()),
        metadata: v.object({ timestamp: v.float64() })
      })
    )
  })

  it('handles optional codec field', () => {
    const wireSchema = z.object({ value: z.string() })
    const fieldSchema = z.string()
    const codec = z.codec(wireSchema, fieldSchema, {
      encode: (val: string) => ({ value: val }),
      decode: (wire: { value: string }) => wire.value
    })

    const optionalCodec = codec.optional()
    const validator = zodToConvex(optionalCodec)

    // Optional codec should be v.optional(wireSchemaValidator)
    expect(validator).toEqual(v.optional(v.object({ value: v.string() })))
  })

  it('handles nullable codec field', () => {
    const wireSchema = z.object({ value: z.string() })
    const fieldSchema = z.string()
    const codec = z.codec(wireSchema, fieldSchema, {
      encode: (val: string) => ({ value: val }),
      decode: (wire: { value: string }) => wire.value
    })

    const nullableCodec = codec.nullable()
    const validator = zodToConvex(nullableCodec)

    // Nullable codec should be v.union(wireSchemaValidator, v.null())
    expect(validator).toEqual(v.union(v.object({ value: v.string() }), v.null()))
  })

  it('handles codec in object field', () => {
    const sensitiveCodec = z.codec(
      z.object({ encrypted: z.string(), iv: z.string() }),
      z.string(),
      {
        encode: (plain: string) => ({ encrypted: btoa(plain), iv: 'random' }),
        decode: (wire: { encrypted: string; iv: string }) => atob(wire.encrypted)
      }
    )

    const schema = z.object({
      id: z.string(),
      secret: sensitiveCodec
    })

    const validator = zodToConvex(schema)

    expect(validator).toEqual(
      v.object({
        id: v.string(),
        secret: v.object({ encrypted: v.string(), iv: v.string() })
      })
    )
  })

  it('handles codec as array element', () => {
    const itemCodec = z.codec(z.object({ raw: z.number() }), z.number(), {
      encode: (n: number) => ({ raw: n }),
      decode: (wire: { raw: number }) => wire.raw
    })

    const schema = z.array(itemCodec)
    const validator = zodToConvex(schema)

    expect(validator).toEqual(v.array(v.object({ raw: v.float64() })))
  })
})
