/**
 * Tests that exercise zodvex APIs with zod/mini schemas.
 *
 * These catch runtime incompatibilities that the main test suite misses,
 * because the main suite uses full `zod` (which has .pick(), .partial(),
 * .description, etc.) while zod/mini does not.
 *
 * Each test constructs schemas using `zod/mini`'s `z` namespace and passes
 * them through zodvex functions that the built mini bundle exports.
 */
import { describe, expect, it } from 'vitest'
import { z as zm } from 'zod/mini'
import { convexCodec, decodeDoc, encodeDoc, encodePartialDoc, zodvexCodec } from '../src/codec'
import { defineZodModel } from '../src/model'
import { toJSONSchema } from '../src/registry'
import { zx } from '../src/zx'

describe('zod-mini runtime compatibility', () => {
  // -----------------------------------------------------------------------
  // convexCodec — deprecated but still exported, must not crash with mini
  // -----------------------------------------------------------------------
  describe('convexCodec with mini schemas', () => {
    it('encode and decode work with mini object schema', () => {
      const schema = zm.object({ name: zm.string(), age: zm.number() })
      const codec = convexCodec(schema as any)

      const encoded = codec.encode({ name: 'Alice', age: 30 })
      expect(encoded).toEqual({ name: 'Alice', age: 30 })

      const decoded = codec.decode({ name: 'Bob', age: 25 })
      expect(decoded).toEqual({ name: 'Bob', age: 25 })
    })

    it('pick() works with mini object schema', () => {
      const schema = zm.object({
        name: zm.string(),
        age: zm.number(),
        email: zm.string()
      })
      const codec = convexCodec(schema as any)
      const picked = codec.pick(['name', 'email'] as any)

      const encoded = picked.encode({ name: 'Alice', email: 'a@b.com' } as any)
      expect(encoded).toEqual({ name: 'Alice', email: 'a@b.com' })
    })

    it('pick() with object key format works with mini schema', () => {
      const schema = zm.object({
        name: zm.string(),
        age: zm.number(),
        email: zm.string()
      })
      const codec = convexCodec(schema as any)
      const picked = codec.pick({ name: true, age: true } as any)

      const encoded = picked.encode({ name: 'Alice', age: 30 } as any)
      expect(encoded).toEqual({ name: 'Alice', age: 30 })
    })
  })

  // -----------------------------------------------------------------------
  // encodePartialDoc — used by DB wrappers for patch operations
  // -----------------------------------------------------------------------
  describe('encodePartialDoc with mini schemas', () => {
    it('encodes a partial mini object schema', () => {
      const schema = zm.object({
        name: zm.string(),
        age: zm.number(),
        active: zm.boolean()
      })

      const result = encodePartialDoc(schema as any, { name: 'updated' })
      expect(result).toEqual({ name: 'updated' })
    })

    it('preserves already-optional fields', () => {
      const schema = zm.object({
        name: zm.string(),
        nickname: zm.optional(zm.string())
      })

      const result = encodePartialDoc(schema as any, { nickname: 'Nick' })
      expect(result).toEqual({ nickname: 'Nick' })
    })
  })

  // -----------------------------------------------------------------------
  // decodeDoc / encodeDoc — basic codec operations with mini schemas
  // -----------------------------------------------------------------------
  describe('decodeDoc/encodeDoc with mini schemas', () => {
    it('round-trips a mini object schema', () => {
      const schema = zm.object({ name: zm.string(), count: zm.number() })

      const decoded = decodeDoc(schema as any, { name: 'test', count: 42 })
      expect(decoded).toEqual({ name: 'test', count: 42 })

      const encoded = encodeDoc(schema as any, { name: 'test', count: 42 })
      expect(encoded).toEqual({ name: 'test', count: 42 })
    })

    it('works with zx.date() codec in mini object', () => {
      const schema = zm.object({
        name: zm.string(),
        createdAt: zx.date()
      })

      const decoded = decodeDoc(schema as any, { name: 'test', createdAt: 1000 })
      expect(decoded.name).toBe('test')
      expect(decoded.createdAt).toBeInstanceOf(Date)

      const encoded = encodeDoc(schema as any, { name: 'test', createdAt: new Date(1000) })
      expect(encoded).toEqual({ name: 'test', createdAt: 1000 })
    })
  })

  // -----------------------------------------------------------------------
  // defineZodModel — core API with mini field schemas
  // -----------------------------------------------------------------------
  describe('defineZodModel with mini field schemas', () => {
    it('creates a model from mini field schemas', () => {
      const model = defineZodModel('test_table', {
        name: zm.string(),
        age: zm.number(),
        active: zm.boolean()
      } as any)

      expect(model.name).toBe('test_table')
      expect(model.schema.doc).toBeDefined()
      expect(model.schema.insert).toBeDefined()
      expect(model.schema.update).toBeDefined()
      expect(model.schema.docArray).toBeDefined()
    })

    it('handles optional and nullable mini fields', () => {
      const model = defineZodModel('test_table', {
        name: zm.string(),
        nickname: zm.optional(zm.string()),
        bio: zm.nullable(zm.string())
      } as any)

      expect(model.schema.doc).toBeDefined()
      expect(model.schema.update).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // toJSONSchema — uses .description internally for zid detection
  // -----------------------------------------------------------------------
  describe('toJSONSchema with mini schemas', () => {
    it('produces JSON schema from a mini object', () => {
      const schema = zm.object({
        name: zm.string(),
        count: zm.number()
      })

      const jsonSchema = toJSONSchema(schema as any)
      expect(jsonSchema).toBeDefined()
      expect(jsonSchema.type).toBe('object')
    })

    it('handles zx.id() in JSON schema output', () => {
      const schema = zm.object({
        userId: zx.id('users'),
        name: zm.string()
      })

      // Should not crash — zid detection uses globalRegistry, not .description
      const jsonSchema = toJSONSchema(schema as any)
      expect(jsonSchema).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // zodvexCodec — custom codec creation with mini wire/runtime schemas
  // -----------------------------------------------------------------------
  describe('zodvexCodec with mini schemas', () => {
    it('creates a codec from mini wire and runtime schemas', () => {
      const wire = zm.object({ value: zm.string(), tag: zm.string() })
      const runtime = zm.custom<{ value: string; tag: string; display: string }>(() => true)

      const codec = zodvexCodec(wire as any, runtime as any, {
        decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
        encode: (r: any) => ({ value: r.value, tag: r.tag })
      })

      expect(codec).toBeDefined()
    })
  })
})
