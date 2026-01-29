import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zodvexCodec, type ZodvexCodec } from '../src/codec'
import { zodToConvex } from '../src/mapping'

/**
 * Tests for ZodvexCodec branded type and zodvexCodec helper function.
 *
 * These tests verify that:
 * 1. Branded codecs work correctly at runtime (encode/decode)
 * 2. zodToConvex extracts wire schema from branded codec type aliases
 * 3. Native z.ZodCodec still works (backwards compatibility)
 */
describe('zodvexCodec', () => {
  it('creates functional codec with encode/decode', () => {
    const codec = zodvexCodec(
      z.object({ ts: z.number() }),
      z.custom<Date>(() => true),
      {
        decode: wire => new Date(wire.ts),
        encode: date => ({ ts: date.getTime() })
      }
    )

    const now = new Date()
    const wire = z.encode(codec, now)
    const decoded = z.decode(codec, wire)

    expect(wire).toEqual({ ts: now.getTime() })
    expect(decoded).toEqual(now)
  })

  it('codec is instanceof ZodCodec', () => {
    const codec = zodvexCodec(
      z.object({ value: z.string() }),
      z.custom<string>(() => true),
      {
        decode: wire => wire.value,
        encode: value => ({ value })
      }
    )

    expect(codec instanceof z.ZodCodec).toBe(true)
  })

  it('zodToConvex produces correct validator from branded codec', () => {
    const codec = zodvexCodec(
      z.object({ value: z.string(), count: z.number() }),
      z.custom<{ display: string }>(() => true),
      {
        decode: wire => ({ display: `${wire.value}: ${wire.count}` }),
        encode: runtime => ({ value: runtime.display, count: 0 })
      }
    )

    const validator = zodToConvex(codec)

    // Should produce object validator matching wire schema
    expect(validator).toEqual(
      v.object({
        value: v.string(),
        count: v.float64()
      })
    )
  })

  it('zodToConvex extracts wire schema through type alias', () => {
    // Simulate the consumer pattern: type alias for cleaner IDE display
    type TimestampWire = z.ZodObject<{ ts: z.ZodNumber }>
    type TimestampRuntime = z.ZodCustom<Date>
    type TimestampCodec = ZodvexCodec<TimestampWire, TimestampRuntime>

    // Factory function with explicit return type
    function createTimestampCodec(): TimestampCodec {
      return zodvexCodec(
        z.object({ ts: z.number() }),
        z.custom<Date>(() => true),
        {
          decode: wire => new Date(wire.ts),
          encode: date => ({ ts: date.getTime() })
        }
      )
    }

    const codec = createTimestampCodec()
    const validator = zodToConvex(codec)

    // Should extract wire schema from branded type, not fall back to v.any()
    expect(validator).toEqual(v.object({ ts: v.float64() }))
  })

  it('backwards compatible: native z.ZodCodec still works', () => {
    // Using z.codec() directly (not zodvexCodec)
    const codec = z.codec(
      z.object({ value: z.string() }),
      z.custom<string>(() => true),
      {
        decode: (wire: { value: string }) => wire.value,
        encode: (value: string) => ({ value })
      }
    )

    const validator = zodToConvex(codec)

    // Should still extract wire schema via structural check
    expect(validator).toEqual(v.object({ value: v.string() }))
  })

  it('handles nested wire schemas', () => {
    type NestedWire = z.ZodObject<{
      outer: z.ZodObject<{
        inner: z.ZodString
        count: z.ZodNumber
      }>
      flag: z.ZodBoolean
    }>

    const codec: ZodvexCodec<NestedWire, z.ZodCustom<{ flat: string }>> = zodvexCodec(
      z.object({
        outer: z.object({
          inner: z.string(),
          count: z.number()
        }),
        flag: z.boolean()
      }),
      z.custom<{ flat: string }>(() => true),
      {
        decode: wire => ({ flat: `${wire.outer.inner}-${wire.outer.count}-${wire.flag}` }),
        encode: runtime => ({
          outer: { inner: runtime.flat, count: 0 },
          flag: true
        })
      }
    )

    const validator = zodToConvex(codec)

    expect(validator).toEqual(
      v.object({
        outer: v.object({
          inner: v.string(),
          count: v.float64()
        }),
        flag: v.boolean()
      })
    )
  })

  it('handles wire schema with optional fields', () => {
    const codec = zodvexCodec(
      z.object({
        required: z.string(),
        optional: z.string().optional()
      }),
      z.custom<{ combined: string }>(() => true),
      {
        decode: wire => ({ combined: wire.required + (wire.optional ?? '') }),
        encode: runtime => ({ required: runtime.combined })
      }
    )

    const validator = zodToConvex(codec)

    expect(validator).toEqual(
      v.object({
        required: v.string(),
        optional: v.optional(v.string())
      })
    )
  })

  it('handles wire schema with nullable fields', () => {
    const codec = zodvexCodec(
      z.object({
        value: z.string().nullable(),
        status: z.enum(['active', 'inactive'])
      }),
      z.custom<{ display: string }>(() => true),
      {
        decode: wire => ({ display: wire.value ?? 'N/A' }),
        encode: runtime => ({ value: runtime.display, status: 'active' as const })
      }
    )

    const validator = zodToConvex(codec)

    expect(validator).toEqual(
      v.object({
        value: v.union(v.string(), v.null()),
        status: v.union(v.literal('active'), v.literal('inactive'))
      })
    )
  })
})

describe('ZodvexCodec type inference', () => {
  it('type: preserves wire schema type through alias', () => {
    // This is a compile-time test - if it compiles, the types work
    type MyWire = z.ZodObject<{ name: z.ZodString; age: z.ZodNumber }>
    type MyRuntime = z.ZodCustom<{ fullName: string }>
    type MyCodec = ZodvexCodec<MyWire, MyRuntime>

    const codec: MyCodec = zodvexCodec(
      z.object({ name: z.string(), age: z.number() }),
      z.custom<{ fullName: string }>(() => true),
      {
        decode: wire => ({ fullName: `${wire.name} (${wire.age})` }),
        encode: runtime => ({ name: runtime.fullName, age: 0 })
      }
    )

    // This assignment should work - codec is typed as MyCodec
    const _typed: MyCodec = codec

    // Runtime check to ensure it's actually a codec
    expect(codec instanceof z.ZodCodec).toBe(true)
  })
})
