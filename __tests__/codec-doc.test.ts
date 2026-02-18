import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { decodeDoc, encodeDoc } from '../src/codec'
import { zx } from '../src/zx'

describe('decodeDoc', () => {
  it('decodes a wire document to runtime types', () => {
    const schema = z.object({
      name: z.string(),
      createdAt: zx.date()
    })

    const wireDoc = { name: 'Alice', createdAt: 1700000000000 }
    const result = decodeDoc(schema, wireDoc)

    expect(result.name).toBe('Alice')
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(1700000000000)
  })

  it('passes through plain fields without codecs', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number()
    })

    const wireDoc = { name: 'Bob', age: 30 }
    const result = decodeDoc(schema, wireDoc)

    expect(result).toEqual({ name: 'Bob', age: 30 })
  })

  it('handles nullable codec fields', () => {
    const schema = z.object({
      deletedAt: zx.date().nullable()
    })

    expect(decodeDoc(schema, { deletedAt: null }).deletedAt).toBe(null)
    expect(decodeDoc(schema, { deletedAt: 1700000000000 }).deletedAt).toBeInstanceOf(Date)
  })

  it('handles optional codec fields', () => {
    const schema = z.object({
      name: z.string(),
      updatedAt: zx.date().optional()
    })

    expect(decodeDoc(schema, { name: 'Alice' })).toEqual({ name: 'Alice' })

    const withDate = decodeDoc(schema, { name: 'Alice', updatedAt: 1700000000000 })
    expect(withDate.updatedAt).toBeInstanceOf(Date)
  })
})

describe('encodeDoc', () => {
  it('encodes a runtime document to wire format', () => {
    const schema = z.object({
      name: z.string(),
      createdAt: zx.date()
    })

    const runtimeDoc = { name: 'Alice', createdAt: new Date(1700000000000) }
    const result = encodeDoc(schema, runtimeDoc)

    expect(result).toEqual({ name: 'Alice', createdAt: 1700000000000 })
  })

  it('strips explicit undefined values', () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional()
    })

    const result = encodeDoc(schema, { name: 'Alice', nickname: undefined })

    expect(result).toEqual({ name: 'Alice' })
    expect('nickname' in result).toBe(false)
  })

  it('handles nullable codec fields', () => {
    const schema = z.object({
      deletedAt: zx.date().nullable()
    })

    expect(encodeDoc(schema, { deletedAt: null })).toEqual({ deletedAt: null })
    expect(encodeDoc(schema, { deletedAt: new Date(1700000000000) })).toEqual({
      deletedAt: 1700000000000
    })
  })
})
