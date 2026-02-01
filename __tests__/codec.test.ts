import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { convexCodec, fromConvexJS, toConvexJS, zodvexCodec } from '../src/codec'

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

  it('converts dates to timestamps and back', () => {
    const schema = z.object({
      created: z.date()
    })

    const codec = convexCodec(schema)
    const original = { created: new Date('2024-01-01T00:00:00Z') }

    const encoded = codec.encode(original)
    expect(encoded.created).toBe(original.created.getTime())

    const decoded = codec.decode(encoded)
    expect(decoded.created).toEqual(original.created)
  })

  it('handles nullable dates', () => {
    const schema = z.object({
      birthday: z.date().nullable()
    })

    const codec = convexCodec(schema)

    const withDate = { birthday: new Date('1990-01-01') }
    const withNull = { birthday: null }

    const encodedDate = codec.encode(withDate)
    const decodedDate = codec.decode(encodedDate)
    expect(decodedDate.birthday).toEqual(withDate.birthday)

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

    // Test data - original has more fields than picked
    // const original = { id: '123', name: 'John', email: 'john@example.com', age: 30 }
    const picked = { name: 'John', email: 'john@example.com' }

    const encoded = pickedCodec.encode(picked)
    const decoded = pickedCodec.decode(encoded)

    expect(decoded).toEqual(picked)
  })
})

describe('toConvexJS', () => {
  it('removes undefined values', () => {
    const input = {
      a: 'test',
      b: undefined,
      c: null,
      d: 0
    }

    const result = toConvexJS(input)

    expect(result).toEqual({
      a: 'test',
      c: null,
      d: 0
    })
    expect('b' in result).toBe(false)
  })

  it('converts dates to timestamps', () => {
    const date = new Date('2024-01-01T12:00:00Z')
    const input = {
      created: date,
      updated: null
    }

    const result = toConvexJS(input)

    expect(result).toEqual({
      created: date.getTime(),
      updated: null
    })
  })

  it('handles nested objects', () => {
    const input = {
      user: {
        name: 'John',
        metadata: {
          created: new Date('2024-01-01'),
          optional: undefined
        }
      }
    }

    const result = toConvexJS(input)

    expect(result).toEqual({
      user: {
        name: 'John',
        metadata: {
          created: new Date('2024-01-01').getTime()
        }
      }
    })
  })

  it('handles arrays', () => {
    const date = new Date()
    const input = {
      items: [1, 'test', date, null, undefined]
    }

    const result = toConvexJS(input)

    expect(result).toEqual({
      items: [1, 'test', date.getTime(), null, undefined]
    })
  })
})

describe('fromConvexJS', () => {
  it('converts timestamps to dates based on schema', () => {
    const schema = z.object({
      created: z.date(),
      count: z.number()
    })

    const input = {
      created: 1704110400000, // 2024-01-01T12:00:00Z
      count: 42
    }

    const result = fromConvexJS(input, schema)

    expect(result.created).toBeInstanceOf(Date)
    expect(result.created.getTime()).toBe(1704110400000)
    expect(result.count).toBe(42)
  })

  it('handles nullable dates', () => {
    const schema = z.object({
      birthday: z.date().nullable()
    })

    const withTimestamp = { birthday: 1704110400000 }
    const withNull = { birthday: null }

    const result1 = fromConvexJS(withTimestamp, schema)
    expect(result1.birthday).toBeInstanceOf(Date)

    const result2 = fromConvexJS(withNull, schema)
    expect(result2.birthday).toBe(null)
  })

  it('handles nested schemas', () => {
    const schema = z.object({
      user: z.object({
        joined: z.date(),
        name: z.string()
      })
    })

    const input = {
      user: {
        joined: 1704110400000,
        name: 'John'
      }
    }

    const result = fromConvexJS(input, schema)

    expect(result.user.joined).toBeInstanceOf(Date)
    expect(result.user.name).toBe('John')
  })

  it('handles arrays with dates', () => {
    const schema = z.object({
      events: z.array(z.date())
    })

    const input = {
      events: [1704110400000, 1704196800000]
    }

    const result = fromConvexJS(input, schema)

    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toBeInstanceOf(Date)
    expect(result.events[1]).toBeInstanceOf(Date)
  })

  it('passes through non-date values unchanged', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
      active: z.boolean()
    })

    const input = {
      name: 'test',
      count: 123,
      active: true
    }

    const result = fromConvexJS(input, schema)

    expect(result).toEqual(input)
  })
})

describe('automatic codec detection', () => {
  it('toConvexJS automatically encodes zodvexCodec values', () => {
    // Create a codec that transforms Date to { ts: number }
    const dateCodec = zodvexCodec(
      z.object({ ts: z.number() }),
      z.custom<Date>(() => true),
      {
        decode: wire => new Date(wire.ts),
        encode: date => ({ ts: date.getTime() })
      }
    )

    const now = new Date('2024-06-15T12:00:00Z')
    const result = toConvexJS(dateCodec, now)

    // Should automatically encode Date → { ts: number }
    expect(result).toEqual({ ts: now.getTime() })
  })

  it('fromConvexJS automatically decodes zodvexCodec values', () => {
    // Create a codec that transforms { ts: number } to Date
    const dateCodec = zodvexCodec(
      z.object({ ts: z.number() }),
      z.custom<Date>(() => true),
      {
        decode: wire => new Date(wire.ts),
        encode: date => ({ ts: date.getTime() })
      }
    )

    const timestamp = 1718452800000 // 2024-06-15T12:00:00Z
    const result = fromConvexJS({ ts: timestamp }, dateCodec)

    // Should automatically decode { ts: number } → Date
    expect(result).toBeInstanceOf(Date)
    expect(result.getTime()).toBe(timestamp)
  })

  it('handles nested codecs with Date in wire schema', () => {
    // Codec where wire schema contains a Date (which needs Convex conversion)
    const codec = zodvexCodec(
      z.object({
        name: z.string(),
        timestamp: z.date() // Date in wire schema
      }),
      z.custom<{ displayName: string; when: Date }>(() => true),
      {
        decode: wire => ({ displayName: wire.name, when: wire.timestamp }),
        encode: runtime => ({ name: runtime.displayName, timestamp: runtime.when })
      }
    )

    const now = new Date('2024-06-15T12:00:00Z')
    const runtimeValue = { displayName: 'Test', when: now }

    // toConvexJS should: encode runtime → wire, then convert wire → Convex
    const convexValue = toConvexJS(codec, runtimeValue)

    // Wire schema has Date, which should be converted to timestamp
    expect(convexValue).toEqual({
      name: 'Test',
      timestamp: now.getTime()
    })

    // fromConvexJS should: convert Convex → wire, then decode wire → runtime
    const decoded = fromConvexJS(convexValue, codec)

    expect(decoded.displayName).toBe('Test')
    expect(decoded.when).toBeInstanceOf(Date)
    expect(decoded.when.getTime()).toBe(now.getTime())
  })

  it('works with native z.codec() (not just zodvexCodec)', () => {
    // Native Zod codec should also be auto-detected
    const codec = z.codec(
      z.object({ value: z.string() }),
      z.custom<number>(() => true),
      {
        decode: (wire: { value: string }) => parseInt(wire.value, 10),
        encode: (num: number) => ({ value: num.toString() })
      }
    )

    const encoded = toConvexJS(codec, 42)
    expect(encoded).toEqual({ value: '42' })

    const decoded = fromConvexJS({ value: '123' }, codec)
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

    const convexValue = toConvexJS(schema, runtimeValue)

    expect(convexValue).toEqual({
      id: 'user-123',
      secret: { encrypted: btoa('my-password') }
    })

    const decoded = fromConvexJS(convexValue, schema)

    expect(decoded.id).toBe('user-123')
    expect(decoded.secret).toBe('my-password')
  })
})
