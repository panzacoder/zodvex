/**
 * Reproduction test for double-validation bug in custom builders.
 *
 * Issue: Custom builders call both fromConvexJS() and argsSchema.safeParse()
 * on mutation args. For ZodCodec fields where the runtime class stores data
 * internally (not as properties matching wire schema), the second validation
 * fails because Zod tries to validate the runtime instance as wire format.
 *
 * @see 2026-02-02-custom-builder-double-codec-validation.md
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fromConvexJS, zodvexCodec } from '../src'

// ============================================================================
// Test Setup: Codec that stores value internally (like SensitiveField)
// ============================================================================

// This pattern matches hotpot's SensitiveField: value stored in WeakMap
const PRIVATE_VALUES = new WeakMap<SensitiveWrapper<unknown>, unknown>()

class SensitiveWrapper<T> {
  public readonly status: 'full' | 'hidden'
  public readonly field?: string
  public readonly reason?: string

  private constructor(value: T | null, status: 'full' | 'hidden', field?: string, reason?: string) {
    PRIVATE_VALUES.set(this, value)
    this.status = status
    this.field = field
    this.reason = reason
  }

  static full<T>(value: T, field?: string): SensitiveWrapper<T> {
    return new SensitiveWrapper(value, 'full', field)
  }

  static hidden<T>(field?: string, reason?: string): SensitiveWrapper<T> {
    return new SensitiveWrapper<T>(null, 'hidden', field, reason)
  }

  static fromWire<T>(wire: {
    value: T | null
    status: 'full' | 'hidden'
    __sensitiveField?: string
    reason?: string
  }): SensitiveWrapper<T> {
    if (wire.status === 'hidden') {
      return SensitiveWrapper.hidden<T>(wire.__sensitiveField, wire.reason)
    }
    return new SensitiveWrapper<T>(wire.value, wire.status, wire.__sensitiveField, wire.reason)
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
    __sensitiveField?: string
    reason?: string
  } {
    const wire: {
      value: T | null
      status: 'full' | 'hidden'
      __sensitiveField?: string
      reason?: string
    } = {
      status: this.status,
      value: this.status === 'full' ? (PRIVATE_VALUES.get(this) as T) : null
    }
    if (this.field) wire.__sensitiveField = this.field
    if (this.reason) wire.reason = this.reason
    return wire
  }
}

// Create sensitive codec (matches hotpot's sensitive() pattern)
function createSensitiveCodec<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({
    value: inner.nullable(),
    status: z.enum(['full', 'hidden']),
    reason: z.string().optional(),
    __sensitiveField: z.string().optional()
  })

  const fieldSchema = z.custom<SensitiveWrapper<z.output<T>>>(
    val => val instanceof SensitiveWrapper
  )

  return zodvexCodec(wireSchema, fieldSchema, {
    decode: wire => SensitiveWrapper.fromWire(wire),
    encode: field => field.toWire()
  })
}

// ============================================================================
// Also test: Simple wrapper that exposes value as property (should work)
// ============================================================================

class SimpleWrapper<T> {
  constructor(
    public value: T,
    public metadata?: string
  ) {}

  static fromWire<T>(wire: { value: T; meta?: string }): SimpleWrapper<T> {
    return new SimpleWrapper(wire.value, wire.meta)
  }

  toWire(): { value: T; meta?: string } {
    const wire: { value: T; meta?: string } = { value: this.value }
    if (this.metadata) wire.meta = this.metadata
    return wire
  }
}

const createSimpleCodec = <T extends z.ZodTypeAny>(inner: T) =>
  zodvexCodec(
    z.object({
      value: inner,
      meta: z.string().optional()
    }),
    z.custom<SimpleWrapper<z.output<T>>>(val => val instanceof SimpleWrapper),
    {
      decode: wire => SimpleWrapper.fromWire(wire),
      encode: runtime => runtime.toWire()
    }
  )

// ============================================================================
// Bug Reproduction Tests
// ============================================================================

describe('ZodCodec double-validation bug', () => {
  // Sensitive codec: stores value in WeakMap (like hotpot's SensitiveField)
  const sensitiveString = createSensitiveCodec(z.string())

  const sensitiveSchema = z.object({
    clinicId: z.string(),
    email: sensitiveString.optional(),
    firstName: sensitiveString.optional()
  })

  // Simple codec: exposes value as property (works with double validation)
  const simpleString = createSimpleCodec(z.string())

  const simpleSchema = z.object({
    name: z.string(),
    wrapped: simpleString.optional()
  })

  describe('fromConvexJS correctly decodes wire → runtime', () => {
    it('decodes sensitive codec to SensitiveWrapper', () => {
      const wireArgs = {
        clinicId: 'clinic-1',
        email: { value: 'test@example.com', status: 'full' as const },
        firstName: { value: 'John', status: 'full' as const }
      }

      const decoded = fromConvexJS(wireArgs, sensitiveSchema)

      expect(decoded.clinicId).toBe('clinic-1')
      expect(decoded.email).toBeInstanceOf(SensitiveWrapper)
      expect(decoded.email?.expose()).toBe('test@example.com')
      expect(decoded.firstName).toBeInstanceOf(SensitiveWrapper)
      expect(decoded.firstName?.expose()).toBe('John')
    })

    it('decodes simple codec to SimpleWrapper', () => {
      const wireArgs = {
        name: 'test',
        wrapped: { value: 'hello', meta: 'some-metadata' }
      }

      const decoded = fromConvexJS(wireArgs, simpleSchema)

      expect(decoded.name).toBe('test')
      expect(decoded.wrapped).toBeInstanceOf(SimpleWrapper)
      expect(decoded.wrapped?.value).toBe('hello')
    })

    it('handles missing optional codec fields', () => {
      const wireArgs = { clinicId: 'clinic-1' }

      const decoded = fromConvexJS(wireArgs, sensitiveSchema)

      expect(decoded.clinicId).toBe('clinic-1')
      expect(decoded.email).toBeUndefined()
      expect(decoded.firstName).toBeUndefined()
    })
  })

  describe('FAILING: safeParse on already-decoded data should work', () => {
    it('should succeed when parsing decoded SensitiveWrapper', () => {
      const wireArgs = {
        clinicId: 'clinic-1',
        email: { value: 'test@example.com', status: 'full' as const },
        firstName: { value: 'John', status: 'full' as const }
      }

      // Step 1: Decode wire → runtime (this works)
      const decoded = fromConvexJS(wireArgs, sensitiveSchema)
      expect(decoded.email).toBeInstanceOf(SensitiveWrapper)
      expect(decoded.firstName).toBeInstanceOf(SensitiveWrapper)

      // Step 2: safeParse on decoded data
      // BUG: Currently fails because codec tries to re-validate as wire format
      // EXPECTED: Should succeed - data is already decoded and valid
      const result = sensitiveSchema.safeParse(decoded)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.email).toBeInstanceOf(SensitiveWrapper)
        expect(result.data.email?.expose()).toBe('test@example.com')
        expect(result.data.firstName).toBeInstanceOf(SensitiveWrapper)
        expect(result.data.firstName?.expose()).toBe('John')
      }
    })

    it('should work in zCustomMutationBuilder flow (fromConvexJS then safeParse)', () => {
      const wireArgs = {
        clinicId: 'clinic-1',
        email: { value: 'test@example.com', status: 'full' as const }
      }

      // This is what zCustomMutationBuilder does in src/custom.ts:360-364
      const decoded = fromConvexJS(wireArgs, sensitiveSchema)
      const parsed = sensitiveSchema.safeParse(decoded)

      // EXPECTED: Should succeed after fix
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.email).toBeInstanceOf(SensitiveWrapper)
      }
    })
  })

  describe('OK: safeParse on simple codec (value as property) works', () => {
    it('succeeds when runtime class exposes value as property', () => {
      const wireArgs = {
        name: 'test',
        wrapped: { value: 'hello' }
      }

      // Step 1: Decode
      const decoded = fromConvexJS(wireArgs, simpleSchema)
      expect(decoded.wrapped).toBeInstanceOf(SimpleWrapper)

      // Step 2: safeParse on decoded data
      // This works because SimpleWrapper.value is a public property
      const result = simpleSchema.safeParse(decoded)

      // This passes because the codec can read .value from the instance
      expect(result.success).toBe(true)
    })
  })

  describe('Direct parse of wire format always works', () => {
    it('sensitiveSchema.parse() on wire format works', () => {
      const wireArgs = {
        clinicId: 'clinic-1',
        email: { value: 'test@example.com', status: 'full' as const }
      }

      const result = sensitiveSchema.parse(wireArgs)

      expect(result.clinicId).toBe('clinic-1')
      expect(result.email).toBeInstanceOf(SensitiveWrapper)
      expect(result.email?.expose()).toBe('test@example.com')
    })
  })

  describe('FAILING: Nested and array sensitive codec scenarios', () => {
    const nestedSchema = z.object({
      patient: z.object({
        ssn: sensitiveString
      })
    })

    it('should work with nested sensitive codec after fromConvexJS', () => {
      const wireArgs = {
        patient: {
          ssn: { value: '123-45-6789', status: 'full' as const }
        }
      }

      const decoded = fromConvexJS(wireArgs, nestedSchema)
      expect(decoded.patient.ssn).toBeInstanceOf(SensitiveWrapper)

      // EXPECTED: Should succeed after fix
      const result = nestedSchema.safeParse(decoded)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.patient.ssn).toBeInstanceOf(SensitiveWrapper)
        expect(result.data.patient.ssn.expose()).toBe('123-45-6789')
      }
    })

    const arraySchema = z.object({
      secrets: z.array(sensitiveString)
    })

    it('should work with array of sensitive codecs after fromConvexJS', () => {
      const wireArgs = {
        secrets: [
          { value: 'secret1', status: 'full' as const },
          { value: 'secret2', status: 'full' as const }
        ]
      }

      const decoded = fromConvexJS(wireArgs, arraySchema)
      expect(decoded.secrets[0]).toBeInstanceOf(SensitiveWrapper)
      expect(decoded.secrets[1]).toBeInstanceOf(SensitiveWrapper)

      // EXPECTED: Should succeed after fix
      const result = arraySchema.safeParse(decoded)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.secrets[0]).toBeInstanceOf(SensitiveWrapper)
        expect(result.data.secrets[0].expose()).toBe('secret1')
        expect(result.data.secrets[1].expose()).toBe('secret2')
      }
    })
  })
})

// ============================================================================
// Additional Edge Cases (for comprehensive fix verification)
// ============================================================================

describe('Edge cases for fix verification', () => {
  const sensitiveString = createSensitiveCodec(z.string())

  const schema = z.object({
    clinicId: z.string(),
    email: sensitiveString.optional()
  })

  it('should preserve validation errors for non-codec fields', () => {
    // Non-codec field has wrong type
    const wireArgs = {
      clinicId: 123,
      email: { value: 'test@example.com', status: 'full' as const }
    }

    // fromConvexJS may or may not throw here depending on implementation
    // The key is that validation should catch the clinicId type error
    try {
      const decoded = fromConvexJS(wireArgs, schema)
      const parsed = schema.safeParse(decoded)
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        // Should have error on clinicId, not on email
        const paths = parsed.error.issues.map(i => i.path.join('.'))
        expect(paths).toContain('clinicId')
      }
    } catch {
      // Also acceptable if fromConvexJS throws on type mismatch
    }
  })

  it('should handle hidden sensitive fields correctly', () => {
    const wireArgs = {
      clinicId: 'clinic-1',
      email: { value: null, status: 'hidden' as const, reason: 'no_access' }
    }

    const decoded = fromConvexJS(wireArgs, schema)
    expect(decoded.email).toBeInstanceOf(SensitiveWrapper)
    expect(decoded.email?.status).toBe('hidden')

    // EXPECTED: Should succeed after fix
    const result = schema.safeParse(decoded)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email?.status).toBe('hidden')
    }
  })
})
