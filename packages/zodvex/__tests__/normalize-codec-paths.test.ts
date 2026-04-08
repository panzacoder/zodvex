import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalizeCodecPaths, safeEncode } from '../src/internal/normalizeCodecPaths'
import { $ZodError } from '../src/internal/zod-core'
import { zx } from '../src/internal/zx'

// Helper: create a ZodError with specific issues
function makeZodError(issues: Array<{ path: (string | number)[]; message: string }>): z.ZodError {
  return new z.ZodError(
    issues.map(i => ({
      code: 'custom' as const,
      path: i.path,
      message: i.message
    }))
  )
}

// A custom codec with nested wire schema (like a consumer's CustomField)
const customString = zx.codec(z.object({ value: z.string(), status: z.string() }), z.string(), {
  decode: wire => wire.value,
  encode: value => ({ value, status: 'full' })
})

describe('normalizeCodecPaths', () => {
  describe('non-codec schemas — paths pass through unchanged', () => {
    it('flat object with no codecs', () => {
      const schema = z.object({ name: z.string(), age: z.number() })
      const error = makeZodError([{ path: ['name'], message: 'Required' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['name'])
    })

    it('nested object with no codecs', () => {
      const schema = z.object({
        address: z.object({ street: z.string(), city: z.string() })
      })
      const error = makeZodError([{ path: ['address', 'street'], message: 'Required' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['address', 'street'])
    })
  })

  describe('codec fields — wire-internal path segments truncated', () => {
    it('truncates nested wire path to codec field name', () => {
      const schema = z.object({
        email: customString,
        name: z.string()
      })
      const error = makeZodError([{ path: ['email', 'value'], message: 'Invalid' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['email'])
    })

    it('truncates deeper wire paths', () => {
      const schema = z.object({ email: customString })
      const error = makeZodError([{ path: ['email', 'status'], message: 'Invalid status' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['email'])
    })

    it('preserves message from original issue', () => {
      const schema = z.object({ email: customString })
      const error = makeZodError([{ path: ['email', 'value'], message: 'Too short' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].message).toBe('Too short')
    })
  })

  describe('scalar codecs (zx.date) — no extra segments to truncate', () => {
    it('single-segment path passes through unchanged', () => {
      const schema = z.object({ createdAt: zx.date() })
      const error = makeZodError([{ path: ['createdAt'], message: 'Expected number' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['createdAt'])
    })
  })

  describe('codecs inside wrappers', () => {
    it('optional codec field', () => {
      const schema = z.object({ email: customString.optional() })
      const error = makeZodError([{ path: ['email', 'value'], message: 'Invalid' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['email'])
    })

    it('nullable codec field', () => {
      const schema = z.object({ email: customString.nullable() })
      const error = makeZodError([{ path: ['email', 'value'], message: 'Invalid' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['email'])
    })
  })

  describe('codecs inside arrays', () => {
    it('truncates wire-internal path after array index', () => {
      const schema = z.object({
        contacts: z.array(z.object({ email: customString }))
      })
      const error = makeZodError([{ path: ['contacts', 0, 'email', 'value'], message: 'Invalid' }])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['contacts', 0, 'email'])
    })
  })

  describe('multiple issues', () => {
    it('normalizes all issues independently', () => {
      const schema = z.object({
        email: customString,
        phone: customString,
        name: z.string()
      })
      const error = makeZodError([
        { path: ['email', 'value'], message: 'Invalid email' },
        { path: ['phone', 'status'], message: 'Invalid status' },
        { path: ['name'], message: 'Required' }
      ])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues).toHaveLength(3)
      expect(normalized.issues[0].path).toEqual(['email'])
      expect(normalized.issues[1].path).toEqual(['phone'])
      expect(normalized.issues[2].path).toEqual(['name'])
    })
  })

  describe('mixed codec and non-codec nested objects', () => {
    it('truncates codec paths but preserves non-codec nested paths', () => {
      const schema = z.object({
        email: customString,
        address: z.object({ street: z.string(), city: z.string() })
      })
      const error = makeZodError([
        { path: ['email', 'value'], message: 'Invalid' },
        { path: ['address', 'street'], message: 'Required' }
      ])

      const normalized = normalizeCodecPaths(error, schema)

      expect(normalized.issues[0].path).toEqual(['email'])
      expect(normalized.issues[1].path).toEqual(['address', 'street'])
    })
  })
})

describe('safeEncode', () => {
  it('encodes valid data through codec without error', () => {
    const schema = z.object({ email: customString })
    const result = safeEncode(schema, { email: 'test@example.com' })

    expect(result).toEqual({ email: { value: 'test@example.com', status: 'full' } })
  })

  it('throws ZodError with normalized paths on validation failure', () => {
    const schema = z.object({
      email: customString,
      name: z.string()
    })

    try {
      safeEncode(schema, { email: 123, name: 42 })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf($ZodError)
      const err = e as z.ZodError
      // Paths should be normalized — no wire-internal segments
      const paths = err.issues.map(i => i.path)
      for (const path of paths) {
        expect(path).not.toContain('value')
        expect(path).not.toContain('status')
      }
    }
  })

  it('re-throws non-ZodError exceptions unchanged', () => {
    const badSchema = {
      _zod: { def: {} }
    } as any

    expect(() => safeEncode(badSchema, {})).toThrow()
  })
})
