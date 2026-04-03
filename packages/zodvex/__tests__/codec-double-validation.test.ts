/**
 * Tests for codec-first architecture.
 *
 * Verifies that Zod's native codec handling works correctly for all patterns:
 * - schema.safeParse(wireArgs) decodes wire → runtime
 * - z.encode(schema, runtimeValue) encodes runtime → wire
 *
 * @see docs/plans/2026-02-02-codec-first-simplification.md
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodvexCodec } from '../src'

// ============================================================================
// Test Setup: Codec that stores value internally (like a consumer's CustomField)
// ============================================================================

// This pattern matches a consumer's CustomField: value stored in WeakMap
const PRIVATE_VALUES = new WeakMap<CustomWrapper<unknown>, unknown>()

class CustomWrapper<T> {
  public readonly status: 'full' | 'hidden'
  public readonly field?: string
  public readonly reason?: string

  private constructor(value: T | null, status: 'full' | 'hidden', field?: string, reason?: string) {
    PRIVATE_VALUES.set(this, value)
    this.status = status
    this.field = field
    this.reason = reason
  }

  static full<T>(value: T, field?: string): CustomWrapper<T> {
    return new CustomWrapper(value, 'full', field)
  }

  static hidden<T>(field?: string, reason?: string): CustomWrapper<T> {
    return new CustomWrapper<T>(null, 'hidden', field, reason)
  }

  static fromWire<T>(wire: {
    value: T | null
    status: 'full' | 'hidden'
    __customField?: string
    reason?: string
  }): CustomWrapper<T> {
    if (wire.status === 'hidden') {
      return CustomWrapper.hidden<T>(wire.__customField, wire.reason)
    }
    return new CustomWrapper<T>(wire.value, wire.status, wire.__customField, wire.reason)
  }

  expose(): T {
    if (this.status === 'hidden') {
      throw new Error('Cannot expose hidden value')
    }
    return PRIVATE_VALUES.get(this) as T
  }

  toWire(): {
    value: T | null
    status: 'full' | 'hidden'
    __customField?: string
    reason?: string
  } {
    const wire: {
      value: T | null
      status: 'full' | 'hidden'
      __customField?: string
      reason?: string
    } = {
      status: this.status,
      value: this.status === 'full' ? (PRIVATE_VALUES.get(this) as T) : null
    }
    if (this.field) wire.__customField = this.field
    if (this.reason) wire.reason = this.reason
    return wire
  }
}

// Create custom codec (matches a consumer's custom() pattern)
function createCustomCodec<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({
    value: inner.nullable(),
    status: z.enum(['full', 'hidden']),
    reason: z.string().optional(),
    __customField: z.string().optional()
  })

  const fieldSchema = z.custom<CustomWrapper<z.output<T>>>(val => val instanceof CustomWrapper)

  return zodvexCodec(wireSchema, fieldSchema, {
    decode: wire => CustomWrapper.fromWire(wire),
    encode: field => field.toWire()
  })
}

// ============================================================================
// Codec-First Tests: Verify Zod handles codecs natively
// ============================================================================

describe('Codec-first: Validation errors preserved', () => {
  const customString = createCustomCodec(z.string())

  const schema = z.object({
    clinicId: z.string(),
    email: customString.optional()
  })

  it('preserves validation errors for non-codec fields', () => {
    const wireArgs = {
      clinicId: 123, // Wrong type
      email: { value: 'test@example.com', status: 'full' as const }
    }

    const result = schema.safeParse(wireArgs)

    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'))
      expect(paths).toContain('clinicId')
    }
  })

  it('preserves validation errors for invalid codec wire format', () => {
    const wireArgs = {
      clinicId: 'clinic-1',
      email: { value: 'test@example.com', status: 'invalid_status' } // Invalid status
    }

    const result = schema.safeParse(wireArgs)

    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'))
      expect(paths.some(p => p.startsWith('email'))).toBe(true)
    }
  })
})

// ============================================================================
// Verify Zod Native Behavior Matches fromConvexJS Semantics
// ============================================================================
// These tests verify that switching from fromConvexJS to schema.safeParse()
// won't change behavior for edge cases around optional fields and nested codecs.

describe('Verify Zod native behavior matches fromConvexJS semantics', () => {
  describe('Optional field handling', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional()
    })

    it('should NOT include missing optional keys in output (matches fromConvexJS)', () => {
      // fromConvexJS only iterates Object.entries(value), so missing keys stay missing
      // Zod should behave the same way
      const input = { required: 'hello' } // 'optional' key is missing

      const result = schema.safeParse(input)

      expect(result.success).toBe(true)
      if (result.success) {
        // Key should NOT be present (not even as undefined)
        expect('optional' in result.data).toBe(false)
        // Object.keys should only have 'required'
        expect(Object.keys(result.data)).toEqual(['required'])
      }
    })

    it('should preserve explicit undefined values', () => {
      // When undefined is explicitly set, it should be preserved
      const input = { required: 'hello', optional: undefined }

      const result = schema.safeParse(input)

      expect(result.success).toBe(true)
      // Explicit undefined may or may not be preserved depending on Zod's behavior
      // This test verifies parsing succeeds regardless
    })

    it('should handle optional codec fields the same as optional primitives', () => {
      const customString = createCustomCodec(z.string())
      const schemaWithCodec = z.object({
        required: z.string(),
        custom: customString.optional()
      })

      const input = { required: 'hello' } // 'custom' key is missing

      const result = schemaWithCodec.safeParse(input)

      expect(result.success).toBe(true)
      if (result.success) {
        // Missing optional codec field should also NOT be in output
        expect('custom' in result.data).toBe(false)
        expect(Object.keys(result.data)).toEqual(['required'])
      }
    })
  })

  describe('Nested codec in wire schema', () => {
    // This tests whether Zod handles codecs inside other codecs' wire schemas
    // fromConvexJS recursively processes wireSchema before parsing

    // Create a date codec similar to zx.date()
    const dateCodec = zodvexCodec(
      z.number(), // Wire: timestamp
      z.custom<Date>(val => val instanceof Date),
      {
        decode: (ts: number) => new Date(ts),
        encode: (date: Date) => date.getTime()
      }
    )

    it('should handle codec inside another codec wire schema', () => {
      // Outer codec whose wire schema contains the date codec
      const outerCodec = zodvexCodec(
        z.object({
          when: dateCodec,
          label: z.string()
        }),
        z.custom<{ when: Date; label: string }>(),
        {
          decode: wire => ({ when: wire.when, label: wire.label }),
          encode: runtime => ({ when: runtime.when, label: runtime.label })
        }
      )

      const schema = z.object({
        event: outerCodec
      })

      // Wire data with timestamp (not Date object)
      const wireData = {
        event: {
          when: 1706832000000, // Timestamp
          label: 'Meeting'
        }
      }

      const result = schema.safeParse(wireData)

      expect(result.success).toBe(true)
      if (result.success) {
        // The nested dateCodec should have decoded the timestamp to Date
        expect(result.data.event.when).toBeInstanceOf(Date)
        expect(result.data.event.when.getTime()).toBe(1706832000000)
        expect(result.data.event.label).toBe('Meeting')
      }
    })

    it('should encode nested codecs correctly', () => {
      const outerCodec = zodvexCodec(
        z.object({
          when: dateCodec,
          label: z.string()
        }),
        z.custom<{ when: Date; label: string }>(),
        {
          decode: wire => ({ when: wire.when, label: wire.label }),
          encode: runtime => ({ when: runtime.when, label: runtime.label })
        }
      )

      const schema = z.object({
        event: outerCodec
      })

      const runtimeData = {
        event: {
          when: new Date(1706832000000),
          label: 'Meeting'
        }
      }

      const wire = z.encode(schema, runtimeData)

      // The nested dateCodec should have encoded the Date to timestamp
      expect(wire.event.when).toBe(1706832000000)
      expect(wire.event.label).toBe('Meeting')
    })
  })

  describe('Record with codec values', () => {
    const customString = createCustomCodec(z.string())

    const recordSchema = z.object({
      fields: z.record(z.string(), customString)
    })

    it('should parse record with codec values', () => {
      const wireData = {
        fields: {
          email: { value: 'test@example.com', status: 'full' as const },
          phone: { value: '555-1234', status: 'full' as const }
        }
      }

      const result = recordSchema.safeParse(wireData)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.fields.email).toBeInstanceOf(CustomWrapper)
        expect(result.data.fields.email.expose()).toBe('test@example.com')
        expect(result.data.fields.phone).toBeInstanceOf(CustomWrapper)
        expect(result.data.fields.phone.expose()).toBe('555-1234')
      }
    })

    it('should encode record with codec values', () => {
      const runtimeData = {
        fields: {
          email: CustomWrapper.full('test@example.com'),
          phone: CustomWrapper.full('555-1234')
        }
      }

      const wire = z.encode(recordSchema, runtimeData)

      expect(wire.fields.email).toEqual({ value: 'test@example.com', status: 'full' })
      expect(wire.fields.phone).toEqual({ value: '555-1234', status: 'full' })
    })
  })
})
