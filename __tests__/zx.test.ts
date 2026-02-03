import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zodToConvex, zx } from '../src'

describe('zx namespace', () => {
  describe('zx.date()', () => {
    it('creates a ZodCodec instance', () => {
      const dateSchema = zx.date()
      expect(dateSchema instanceof z.ZodCodec).toBe(true)
    })

    it('encodes Date to timestamp', () => {
      const dateSchema = zx.date()
      const now = new Date('2024-06-15T12:00:00.000Z')

      const encoded = z.encode(dateSchema, now)
      expect(encoded).toBe(now.getTime())
    })

    it('decodes timestamp to Date', () => {
      const dateSchema = zx.date()
      const timestamp = 1718452800000

      const decoded = dateSchema.parse(timestamp)
      expect(decoded).toBeInstanceOf(Date)
      expect(decoded.getTime()).toBe(timestamp)
    })

    it('works with zodToConvex', () => {
      const dateSchema = zx.date()
      const validator = zodToConvex(dateSchema)

      expect(validator).toEqual(v.float64())
    })

    it('works with z.encode()', () => {
      const dateSchema = zx.date()
      const now = new Date('2024-06-15T12:00:00.000Z')

      const convexValue = z.encode(dateSchema, now)
      expect(convexValue).toBe(now.getTime())
    })

    it('works with schema.parse()', () => {
      const dateSchema = zx.date()
      const timestamp = 1718452800000

      const runtimeValue = dateSchema.parse(timestamp)
      expect(runtimeValue).toBeInstanceOf(Date)
      expect(runtimeValue.getTime()).toBe(timestamp)
    })

    it('works in object schemas', () => {
      const schema = z.object({
        name: z.string(),
        createdAt: zx.date(),
        updatedAt: zx.date().optional()
      })

      const now = new Date('2024-06-15T12:00:00.000Z')

      // Encode with z.encode()
      const convexValue = z.encode(schema, {
        name: 'Test',
        createdAt: now
      })
      expect(convexValue).toEqual({
        name: 'Test',
        createdAt: now.getTime()
      })

      // Decode with schema.parse()
      const runtimeValue = schema.parse(convexValue)
      expect(runtimeValue.name).toBe('Test')
      expect(runtimeValue.createdAt).toBeInstanceOf(Date)
      expect(runtimeValue.createdAt.getTime()).toBe(now.getTime())
    })

    it('handles nullable dates', () => {
      const schema = z.object({
        deletedAt: zx.date().nullable()
      })

      // With date
      const withDate = z.encode(schema, { deletedAt: new Date('2024-01-01') })
      expect(typeof withDate.deletedAt).toBe('number')

      const decodedWithDate = schema.parse(withDate)
      expect(decodedWithDate.deletedAt).toBeInstanceOf(Date)

      // With null
      const withNull = z.encode(schema, { deletedAt: null })
      expect(withNull.deletedAt).toBe(null)

      const decodedWithNull = schema.parse(withNull)
      expect(decodedWithNull.deletedAt).toBe(null)
    })
  })

  describe('zx.id()', () => {
    it('creates a string-based validator', () => {
      const idSchema = zx.id('users')

      // Should validate strings
      const result = idSchema.safeParse('abc123')
      expect(result.success).toBe(true)
    })

    it('rejects empty strings', () => {
      const idSchema = zx.id('users')

      const result = idSchema.safeParse('')
      expect(result.success).toBe(false)
    })

    it('has _tableName property', () => {
      const idSchema = zx.id('users')
      expect((idSchema as any)._tableName).toBe('users')
    })

    it('works with zodToConvex', () => {
      const idSchema = zx.id('users')
      const validator = zodToConvex(idSchema)

      expect(validator).toEqual(v.id('users'))
    })

    it('works in object schemas', () => {
      const schema = z.object({
        userId: zx.id('users'),
        teamId: zx.id('teams').optional()
      })

      const validator = zodToConvex(schema)

      expect(validator).toEqual(
        v.object({
          userId: v.id('users'),
          teamId: v.optional(v.id('teams'))
        })
      )
    })
  })

  describe('zx.codec()', () => {
    it('creates a custom codec', () => {
      const codec = zx.codec(
        z.object({ value: z.string() }),
        z.custom<number>(() => true),
        {
          decode: wire => parseInt(wire.value, 10),
          encode: num => ({ value: num.toString() })
        }
      )

      expect(codec instanceof z.ZodCodec).toBe(true)
    })

    it('encodes and decodes correctly', () => {
      const codec = zx.codec(
        z.object({ encrypted: z.string() }),
        z.custom<string>(() => true),
        {
          decode: wire => atob(wire.encrypted),
          encode: value => ({ encrypted: btoa(value) })
        }
      )

      // Encode
      const encoded = z.encode(codec, 'hello')
      expect(encoded).toEqual({ encrypted: btoa('hello') })

      // Decode
      const decoded = codec.parse({ encrypted: btoa('world') })
      expect(decoded).toBe('world')
    })

    it('works with z.encode()/schema.parse()', () => {
      const codec = zx.codec(
        z.object({ ts: z.number() }),
        z.custom<Date>(() => true),
        {
          decode: wire => new Date(wire.ts),
          encode: date => ({ ts: date.getTime() })
        }
      )

      const now = new Date('2024-06-15T12:00:00.000Z')

      const encoded = z.encode(codec, now)
      expect(encoded).toEqual({ ts: now.getTime() })

      const decoded = codec.parse(encoded)
      expect(decoded).toBeInstanceOf(Date)
      expect(decoded.getTime()).toBe(now.getTime())
    })

    it('works with zodToConvex', () => {
      const codec = zx.codec(
        z.object({ data: z.string(), count: z.number() }),
        z.custom<{ combined: string }>(() => true),
        {
          decode: wire => ({ combined: `${wire.data}:${wire.count}` }),
          encode: runtime => ({ data: runtime.combined, count: 0 })
        }
      )

      const validator = zodToConvex(codec)

      expect(validator).toEqual(
        v.object({
          data: v.string(),
          count: v.float64()
        })
      )
    })
  })

  describe('integration: mixed zx and z types', () => {
    it('works with complex schemas', () => {
      const userSchema = z.object({
        id: zx.id('users'),
        name: z.string(),
        email: z.string().email(),
        createdAt: zx.date(),
        teamId: zx.id('teams').optional(),
        lastLoginAt: zx.date().nullable()
      })

      const validator = zodToConvex(userSchema)

      expect(validator).toEqual(
        v.object({
          id: v.id('users'),
          name: v.string(),
          email: v.string(),
          createdAt: v.float64(),
          teamId: v.optional(v.id('teams')),
          lastLoginAt: v.union(v.float64(), v.null())
        })
      )
    })

    it('round-trips data correctly using Zod native functions', () => {
      const schema = z.object({
        userId: zx.id('users'),
        timestamp: zx.date(),
        data: z.object({
          nested: zx.date()
        })
      })

      const original = {
        userId: 'user123',
        timestamp: new Date('2024-06-15T12:00:00.000Z'),
        data: {
          nested: new Date('2024-01-01T00:00:00.000Z')
        }
      }

      const encoded = z.encode(schema, original)
      expect(encoded.userId).toBe('user123')
      expect(typeof encoded.timestamp).toBe('number')
      expect(typeof encoded.data.nested).toBe('number')

      const decoded = schema.parse(encoded)
      expect(decoded.userId).toBe('user123')
      expect(decoded.timestamp).toBeInstanceOf(Date)
      expect(decoded.timestamp.getTime()).toBe(original.timestamp.getTime())
      expect(decoded.data.nested).toBeInstanceOf(Date)
      expect(decoded.data.nested.getTime()).toBe(original.data.nested.getTime())
    })
  })
})
