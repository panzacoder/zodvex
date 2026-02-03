import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { convexCodec, zodvexCodec } from '../src/codec'
import { zx } from '../src/zx'

describe('convexCodec', () => {
  it('creates codec from Zod schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number()
    })

    const codec = convexCodec(schema)

    expect(codec).toHaveProperty('validator')
    expect(codec).toHaveProperty('encode')
    expect(codec).toHaveProperty('decode')
    expect(codec).toHaveProperty('pick')
  })

  it('encodes and decodes data correctly', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number()
    })

    const codec = convexCodec(schema)
    const original = { name: 'John', age: 30 }

    const encoded = codec.encode(original)
    const decoded = codec.decode(encoded)

    expect(decoded).toEqual(original)
  })

  it('handles optional fields correctly', () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional()
    })

    const codec = convexCodec(schema)

    const withNickname = { name: 'John', nickname: 'Johnny' }
    const withoutNickname = { name: 'Jane' }

    expect(codec.decode(codec.encode(withNickname))).toEqual(withNickname)
    expect(codec.decode(codec.encode(withoutNickname))).toEqual(withoutNickname)
  })

  it('converts dates to timestamps and back with zx.date()', () => {
    const schema = z.object({
      created: zx.date()
    })

    const codec = convexCodec(schema)
    const original = { created: new Date('2024-01-01T00:00:00Z') }

    const encoded = codec.encode(original)
    expect(encoded.created).toBe(original.created.getTime())

    const decoded = codec.decode(encoded)
    expect(decoded.created).toBeInstanceOf(Date)
    expect(decoded.created.getTime()).toBe(original.created.getTime())
  })

  it('handles nullable dates with zx.date()', () => {
    const schema = z.object({
      birthday: zx.date().nullable()
    })

    const codec = convexCodec(schema)

    const withDate = { birthday: new Date('1990-01-01') }
    const withNull = { birthday: null }

    const encodedDate = codec.encode(withDate)
    const decodedDate = codec.decode(encodedDate)
    expect(decodedDate.birthday).toBeInstanceOf(Date)
    expect(decodedDate.birthday?.getTime()).toBe(withDate.birthday.getTime())

    const encodedNull = codec.encode(withNull)
    const decodedNull = codec.decode(encodedNull)
    expect(decodedNull.birthday).toBe(null)
  })

  it('pick method creates sub-codec', () => {
    const schema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      age: z.number()
    })

    const codec = convexCodec(schema)
    const pickedCodec = codec.pick({ name: true, email: true })

    const picked = { name: 'John', email: 'john@example.com' }

    const encoded = pickedCodec.encode(picked)
    const decoded = pickedCodec.decode(encoded)

    expect(decoded).toEqual(picked)
  })
})

describe('zodvexCodec', () => {
  it('creates a ZodCodec instance', () => {
    const codec = zodvexCodec(
      z.object({ value: z.string() }),
      z.custom<number>(() => true),
      {
        decode: wire => parseInt(wire.value, 10),
        encode: num => ({ value: num.toString() })
      }
    )

    expect(codec instanceof z.ZodCodec).toBe(true)
  })

  it('encodes with z.encode()', () => {
    const dateCodec = zodvexCodec(
      z.object({ ts: z.number() }),
      z.custom<Date>(() => true),
      {
        decode: wire => new Date(wire.ts),
        encode: date => ({ ts: date.getTime() })
      }
    )

    const now = new Date('2024-06-15T12:00:00Z')
    const result = z.encode(dateCodec, now)

    expect(result).toEqual({ ts: now.getTime() })
  })

  it('decodes with schema.parse()', () => {
    const dateCodec = zodvexCodec(
      z.object({ ts: z.number() }),
      z.custom<Date>(() => true),
      {
        decode: wire => new Date(wire.ts),
        encode: date => ({ ts: date.getTime() })
      }
    )

    const timestamp = 1718452800000
    const result = dateCodec.parse({ ts: timestamp })

    expect(result).toBeInstanceOf(Date)
    expect(result.getTime()).toBe(timestamp)
  })

  it('works with native z.codec()', () => {
    const codec = z.codec(
      z.object({ value: z.string() }),
      z.custom<number>(() => true),
      {
        decode: (wire: { value: string }) => parseInt(wire.value, 10),
        encode: (num: number) => ({ value: num.toString() })
      }
    )

    const encoded = z.encode(codec, 42)
    expect(encoded).toEqual({ value: '42' })

    const decoded = codec.parse({ value: '123' })
    expect(decoded).toBe(123)
  })

  it('handles codec in object schema field', () => {
    const sensitiveCodec = zodvexCodec(
      z.object({ encrypted: z.string() }),
      z.custom<string>(() => true),
      {
        decode: wire => atob(wire.encrypted),
        encode: value => ({ encrypted: btoa(value) })
      }
    )

    const schema = z.object({
      id: z.string(),
      secret: sensitiveCodec
    })

    const runtimeValue = {
      id: 'user-123',
      secret: 'my-password'
    }

    // Encode with z.encode()
    const convexValue = z.encode(schema, runtimeValue)

    expect(convexValue).toEqual({
      id: 'user-123',
      secret: { encrypted: btoa('my-password') }
    })

    // Decode with schema.parse()
    const decoded = schema.parse(convexValue)

    expect(decoded.id).toBe('user-123')
    expect(decoded.secret).toBe('my-password')
  })

  it('round-trips data correctly', () => {
    const codec = zodvexCodec(
      z.object({ ts: z.number() }),
      z.custom<Date>(() => true),
      {
        decode: wire => new Date(wire.ts),
        encode: date => ({ ts: date.getTime() })
      }
    )

    const schema = z.object({
      id: z.string(),
      event: codec
    })

    const original = {
      id: 'event-123',
      event: new Date('2024-06-15T12:00:00Z')
    }

    const encoded = z.encode(schema, original)
    expect(encoded.id).toBe('event-123')
    expect(encoded.event).toEqual({ ts: original.event.getTime() })

    const decoded = schema.parse(encoded)
    expect(decoded.id).toBe('event-123')
    expect(decoded.event).toBeInstanceOf(Date)
    expect(decoded.event.getTime()).toBe(original.event.getTime())
  })
})
