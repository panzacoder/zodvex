import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decodeDoc, encodeDoc, encodePartialDoc } from '../src/internal/codec'
import { zx } from '../src/internal/zx'

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

  it('throws ZodError for invalid wire data', () => {
    const schema = z.object({ name: z.string() })
    expect(() => decodeDoc(schema, { name: 123 })).toThrow()
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

describe('encodePartialDoc', () => {
  it('encodes only the fields present in the partial', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      createdAt: zx.date()
    })

    // Only updating createdAt — name and age are absent
    const result = encodePartialDoc(schema, { createdAt: new Date(1700000000000) })

    expect(result).toEqual({ createdAt: 1700000000000 })
    expect('name' in result).toBe(false)
    expect('age' in result).toBe(false)
  })

  it('handles mix of plain and codec fields', () => {
    const schema = z.object({
      name: z.string(),
      updatedAt: zx.date()
    })

    const result = encodePartialDoc(schema, {
      name: 'Updated Name',
      updatedAt: new Date(1700000000000)
    })

    expect(result).toEqual({ name: 'Updated Name', updatedAt: 1700000000000 })
  })

  it('preserves top-level undefined so patch can delete the field (issue #82)', () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional()
    })

    // Top-level undefined is an intentional unset — it must survive so Convex's
    // patch serializer turns it into a field delete ({ $undefined: null }).
    const result = encodePartialDoc(schema, { name: 'Alice', nickname: undefined })

    expect('nickname' in result).toBe(true)
    expect((result as any).nickname).toBe(undefined)
    expect((result as any).name).toBe('Alice')
  })

  it('strips undefined nested inside a value (not a delete)', () => {
    const schema = z.object({
      name: z.string(),
      profile: z.object({
        bio: z.string().optional(),
        handle: z.string()
      })
    })

    const result = encodePartialDoc(schema, {
      name: 'Alice',
      profile: { bio: undefined, handle: 'alice' }
    })

    // Nested undefined is cleaned (it means "absent", not "delete a top-level field").
    expect((result as any).profile).toEqual({ handle: 'alice' })
    expect('bio' in (result as any).profile).toBe(false)
    // But the top-level key is still preserved as a normal value.
    expect((result as any).name).toBe('Alice')
  })

  it('handles empty partial', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number()
    })

    const result = encodePartialDoc(schema, {})

    expect(result).toEqual({})
  })
})
