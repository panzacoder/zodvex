import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { stripUndefined } from '../src/utils'

/**
 * Tests for undefined stripping behavior.
 * Convex rejects objects with explicit undefined properties,
 * so we need to strip them before returning from handlers.
 */
describe('z.encode() preserves explicit undefined (the problem)', () => {
  it('preserves explicit undefined at top level', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional()
    })

    const input = { required: 'hello', optional: undefined }
    const encoded = z.encode(schema, input)

    // z.encode preserves explicit undefined - this is what Convex rejects
    expect('optional' in encoded).toBe(true)
    expect(encoded.optional).toBe(undefined)
  })

  it('preserves explicit undefined in nested objects', () => {
    const schema = z.object({
      outer: z.object({
        inner: z.string().optional()
      })
    })

    const input = { outer: { inner: undefined } }
    const encoded = z.encode(schema, input)

    expect('inner' in encoded.outer).toBe(true)
    expect(encoded.outer.inner).toBe(undefined)
  })

  it('preserves explicit undefined in arrays', () => {
    const schema = z.array(
      z.object({
        value: z.string().optional()
      })
    )

    const input = [{ value: undefined }]
    const encoded = z.encode(schema, input)

    expect('value' in encoded[0]).toBe(true)
    expect(encoded[0].value).toBe(undefined)
  })

  it('does not add keys for missing optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional()
    })

    const input = { required: 'hello' }
    const encoded = z.encode(schema, input)

    // Missing keys stay missing (this is fine)
    expect('optional' in encoded).toBe(false)
  })
})

describe('stripUndefined helper (the solution)', () => {
  it('removes explicit undefined from top level', () => {
    const input = { required: 'hello', optional: undefined }
    const stripped = stripUndefined(input)

    expect('optional' in stripped).toBe(false)
    expect(stripped.required).toBe('hello')
  })

  it('removes explicit undefined from nested objects', () => {
    const input = { outer: { inner: undefined, keep: 'value' } }
    const stripped = stripUndefined(input)

    expect('inner' in stripped.outer).toBe(false)
    expect(stripped.outer.keep).toBe('value')
  })

  it('removes explicit undefined from objects in arrays', () => {
    const input = [{ value: undefined }, { value: 'a' }]
    const stripped = stripUndefined(input)

    expect('value' in stripped[0]).toBe(false)
    expect(stripped[1].value).toBe('a')
  })

  it('preserves null values (Convex accepts null)', () => {
    const input = { nullable: null, optional: undefined }
    const stripped = stripUndefined(input)

    expect(stripped.nullable).toBe(null)
    expect('optional' in stripped).toBe(false)
  })

  it('preserves non-plain objects (Date, class instances)', () => {
    const date = new Date('2024-01-01')
    const input = { date, optional: undefined }
    const stripped = stripUndefined(input)

    expect(stripped.date).toBe(date)
    expect('optional' in stripped).toBe(false)
  })

  it('handles deeply nested structures', () => {
    const input = {
      a: {
        b: {
          c: undefined,
          d: 'keep'
        },
        e: undefined
      },
      f: [{ g: undefined, h: 1 }]
    }
    const stripped = stripUndefined(input)

    expect('c' in stripped.a.b).toBe(false)
    expect(stripped.a.b.d).toBe('keep')
    expect('e' in stripped.a).toBe(false)
    expect('g' in stripped.f[0]).toBe(false)
    expect(stripped.f[0].h).toBe(1)
  })

  it('returns primitives unchanged', () => {
    expect(stripUndefined('string')).toBe('string')
    expect(stripUndefined(123)).toBe(123)
    expect(stripUndefined(true)).toBe(true)
    expect(stripUndefined(null)).toBe(null)
    expect(stripUndefined(undefined)).toBe(undefined)
  })
})
