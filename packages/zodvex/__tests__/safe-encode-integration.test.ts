import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { safeEncode } from '../src/normalizeCodecPaths'
import { stripUndefined } from '../src/utils'
import { $ZodError } from '../src/zod-core'
import { zx } from '../src/zx'

/**
 * Integration tests for safeEncode with realistic codec patterns.
 * Mirrors the example app's tagged() and zDuration codecs to verify
 * that ZodError paths are normalized at codec boundaries.
 */

// Factory codec with nested wire schema — like example app's tagged()
function tagged(inner: z.ZodTypeAny) {
  const wireSchema = z.object({ value: inner, tag: z.string() })
  const runtimeSchema = z.object({
    value: inner,
    tag: z.string(),
    displayValue: z.string()
  })
  return zx.codec(wireSchema, runtimeSchema, {
    decode: (wire: any) => ({ ...wire, displayValue: `[${wire.tag}] ${wire.value}` }),
    encode: (runtime: any) => ({ value: runtime.value, tag: runtime.tag })
  })
}

// Scalar wire codec — like example app's zDuration
const zDuration = zx.codec(z.number(), z.object({ hours: z.number(), minutes: z.number() }), {
  decode: (mins: number) => ({ hours: Math.floor(mins / 60), minutes: mins % 60 }),
  encode: (d: { hours: number; minutes: number }) => d.hours * 60 + d.minutes
})

describe('safeEncode integration — tagged() codec (nested wire)', () => {
  const argsSchema = z.object({
    email: tagged(z.string()),
    name: z.string()
  })

  it('encodes valid tagged data', () => {
    const result = safeEncode(argsSchema, {
      email: {
        value: 'test@example.com',
        tag: 'primary',
        displayValue: '[primary] test@example.com'
      },
      name: 'Alice'
    })

    expect(stripUndefined(result)).toEqual({
      email: { value: 'test@example.com', tag: 'primary' },
      name: 'Alice'
    })
  })

  it('normalizes error paths — no wire-internal segments leak', () => {
    try {
      // Pass wrong type for tagged field — triggers validation inside codec
      safeEncode(argsSchema, {
        email: { value: 123, tag: 456, displayValue: 789 },
        name: 'Alice'
      })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf($ZodError)
      const err = e as z.ZodError
      const paths = err.issues.map(i => i.path)
      // All email-related errors should stop at ["email"], not ["email", "value"] or ["email", "tag"]
      for (const path of paths) {
        if (path[0] === 'email') {
          expect(path).toEqual(['email'])
        }
      }
    }
  })

  it('preserves non-codec error paths', () => {
    try {
      safeEncode(argsSchema, {
        email: { value: 'ok@test.com', tag: 'primary', displayValue: '[primary] ok@test.com' },
        name: 42
      })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf($ZodError)
      const err = e as z.ZodError
      const namePaths = err.issues.filter(i => i.path[0] === 'name').map(i => i.path)
      expect(namePaths[0]).toEqual(['name'])
    }
  })
})

describe('safeEncode integration — zDuration codec (scalar wire)', () => {
  const argsSchema = z.object({
    title: z.string(),
    estimate: z.optional(zDuration)
  })

  it('encodes valid duration', () => {
    const result = safeEncode(argsSchema, {
      title: 'Build feature',
      estimate: { hours: 2, minutes: 30 }
    })

    expect(stripUndefined(result)).toEqual({
      title: 'Build feature',
      estimate: 150
    })
  })

  it('error path for invalid duration stays at field level', () => {
    try {
      safeEncode(argsSchema, {
        title: 'Build feature',
        estimate: 'not a duration object'
      })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf($ZodError)
      const err = e as z.ZodError
      const estimatePaths = err.issues.filter(i => i.path[0] === 'estimate').map(i => i.path)
      // Scalar codec — path should be ["estimate"] or ["estimate", "hours"] etc
      // Either way, no wire-internal leakage (wire is just z.number())
      for (const path of estimatePaths) {
        expect(path[0]).toBe('estimate')
      }
    }
  })
})

describe('safeEncode integration — tagged() in array', () => {
  const argsSchema = z.object({
    tags: z.array(tagged(z.string()))
  })

  it('normalizes paths inside arrays', () => {
    try {
      safeEncode(argsSchema, {
        tags: [{ value: 123, tag: 456, displayValue: 'bad' }]
      })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf($ZodError)
      const err = e as z.ZodError
      const paths = err.issues.map(i => i.path)
      // Should be ["tags", 0] — not ["tags", 0, "value"] or ["tags", 0, "tag"]
      for (const path of paths) {
        expect(path.length).toBeLessThanOrEqual(2)
        expect(path[0]).toBe('tags')
        expect(path[1]).toBe(0)
      }
    }
  })
})
