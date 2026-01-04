/**
 * Spike 2: End-to-end flow validation
 *
 * Goal: Validate that:
 * 1. DB raw → server SensitiveField → apply policy once → wire envelope → client decode
 * 2. Prove the "apply policy once" optimization works
 * 3. Default deny behavior is correct
 */

import { describe, expect, it } from 'bun:test'
import type { Value } from 'convex/values'

// --- Type Definitions ---

/**
 * DB storage shape - what's stored in Convex
 * The raw value is stored, never the status
 */
type SensitiveDb<T> = {
  __sensitiveValue: T
  __checksum?: string
  __algo?: string
}

/**
 * Wire format - what's sent over the network
 * Discriminated by status
 */
type SensitiveWire<TStatus extends string = string> = {
  __sensitiveField: string | null
  status: TStatus
  value: unknown
  reason?: string
}

type SensitiveStatus = 'full' | 'masked' | 'hidden'

/**
 * Policy context passed to the resolver
 */
type PolicyContext<TCtx = unknown, TReq = unknown> = {
  ctx: TCtx
  path: string
  requirements?: TReq
  rawValue: unknown
}

/**
 * Policy decision returned by resolver
 */
type PolicyDecision<TStatus extends string = SensitiveStatus> = {
  status: TStatus
  reason?: string
  mask?: (value: unknown) => unknown
}

type PolicyResolver<TCtx = unknown, TReq = unknown> = (
  context: PolicyContext<TCtx, TReq>
) => PolicyDecision | Promise<PolicyDecision>

// --- SensitiveField Runtime Class ---

// Store values in a WeakMap to prevent leaks
const VALUES = new WeakMap<SensitiveField<any>, unknown>()

class SensitiveField<T> {
  public readonly status: SensitiveStatus
  public readonly field: string | null
  public readonly reason?: string

  private constructor(
    value: T | undefined,
    status: SensitiveStatus,
    field: string | null,
    reason?: string
  ) {
    VALUES.set(this, value)
    this.status = status
    this.field = field
    this.reason = reason
  }

  static full<T>(value: T, field?: string): SensitiveField<T> {
    return new SensitiveField(value, 'full', field ?? null)
  }

  static masked<T>(maskedValue: T, field?: string, reason?: string): SensitiveField<T> {
    return new SensitiveField(maskedValue, 'masked', field ?? null, reason)
  }

  static hidden<T>(field?: string, reason?: string): SensitiveField<T> {
    return new SensitiveField<T>(undefined, 'hidden', field ?? null, reason)
  }

  /**
   * Unwrap the raw value. Throws if status is not 'full'.
   */
  unwrap(): T {
    if (this.status !== 'full') {
      throw new Error(
        `Cannot unwrap ${this.status} SensitiveField: ${this.reason ?? 'access denied'}`
      )
    }
    return VALUES.get(this) as T
  }

  /**
   * Get the value for the current status (masked value for 'masked', undefined for 'hidden')
   */
  getValue(): T | undefined {
    if (this.status === 'hidden') {
      return undefined
    }
    return VALUES.get(this) as T
  }

  /**
   * Serialize to wire format for transport
   */
  toWire(): SensitiveWire {
    return {
      __sensitiveField: this.field,
      status: this.status,
      value: this.status === 'hidden' ? null : VALUES.get(this),
      ...(this.reason && { reason: this.reason })
    }
  }

  /**
   * Deserialize from wire format (client-side)
   */
  static fromWire<T>(wire: SensitiveWire): SensitiveField<T> {
    return new SensitiveField<T>(
      wire.value as T | undefined,
      wire.status as SensitiveStatus,
      wire.__sensitiveField,
      wire.reason
    )
  }

  // Prevent implicit string coercion
  toString(): string {
    console.warn(`Attempted to coerce SensitiveField (${this.field}) to string`)
    return '[SensitiveField]'
  }

  valueOf() {
    return this.toString()
  }

  [Symbol.toPrimitive]() {
    return this.toString()
  }
}

// --- Helper Functions ---

/**
 * Check if a value is a DB-stored sensitive field
 */
function isSensitiveDb(value: unknown): value is SensitiveDb<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__sensitiveValue' in value
  )
}

/**
 * Wrap a DB value as a SensitiveField with 'full' access
 * (Before policy is applied)
 */
function fromDb<T>(dbValue: SensitiveDb<T>, field?: string): SensitiveField<T> {
  return SensitiveField.full(dbValue.__sensitiveValue, field)
}

/**
 * Apply a policy decision to create the final SensitiveField
 */
function applyDecision<T>(
  rawValue: T,
  decision: PolicyDecision,
  field?: string
): SensitiveField<T> {
  switch (decision.status) {
    case 'full':
      return SensitiveField.full(rawValue, field)
    case 'masked':
      const maskedValue = decision.mask ? decision.mask(rawValue) : rawValue
      return SensitiveField.masked(maskedValue as T, field, decision.reason)
    case 'hidden':
      return SensitiveField.hidden<T>(field, decision.reason)
    default:
      // Default deny - treat unknown status as hidden
      return SensitiveField.hidden<T>(field, 'unknown status')
  }
}

/**
 * Apply policy to a single sensitive DB value
 */
async function applySinglePolicy<T, TCtx>(
  dbValue: SensitiveDb<T>,
  ctx: TCtx,
  resolver: PolicyResolver<TCtx>,
  field?: string,
  requirements?: unknown
): Promise<SensitiveField<T>> {
  const decision = await resolver({
    ctx,
    path: field ?? '',
    requirements,
    rawValue: dbValue.__sensitiveValue
  })
  return applyDecision(dbValue.__sensitiveValue, decision, field)
}

// --- Tests ---

describe('Spike 2: End-to-end flow validation', () => {
  describe('DB → SensitiveField wrapping', () => {
    it('should wrap a DB value as a full SensitiveField', () => {
      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'secret123' }

      const field = fromDb(dbValue, 'password')

      expect(field.status).toBe('full')
      expect(field.field).toBe('password')
      expect(field.unwrap()).toBe('secret123')
    })

    it('should detect SensitiveDb values', () => {
      expect(isSensitiveDb({ __sensitiveValue: 'test' })).toBe(true)
      expect(isSensitiveDb({ __sensitiveValue: 123 })).toBe(true)
      expect(isSensitiveDb({ value: 'test' })).toBe(false)
      expect(isSensitiveDb('string')).toBe(false)
      expect(isSensitiveDb(null)).toBe(false)
    })
  })

  describe('Policy application', () => {
    it('should apply full access policy', async () => {
      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'my-ssn' }
      const resolver: PolicyResolver = () => ({ status: 'full' })

      const field = await applySinglePolicy(dbValue, {}, resolver, 'ssn')

      expect(field.status).toBe('full')
      expect(field.unwrap()).toBe('my-ssn')
    })

    it('should apply masked policy with mask function', async () => {
      const dbValue: SensitiveDb<string> = { __sensitiveValue: '123-45-6789' }
      const resolver: PolicyResolver = () => ({
        status: 'masked',
        reason: 'limited access',
        mask: (v) => `***-**-${String(v).slice(-4)}`
      })

      const field = await applySinglePolicy(dbValue, {}, resolver, 'ssn')

      expect(field.status).toBe('masked')
      expect(field.getValue()).toBe('***-**-6789')
      expect(field.reason).toBe('limited access')
    })

    it('should apply hidden policy', async () => {
      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'secret' }
      const resolver: PolicyResolver = () => ({
        status: 'hidden',
        reason: 'insufficient privileges'
      })

      const field = await applySinglePolicy(dbValue, {}, resolver, 'secret')

      expect(field.status).toBe('hidden')
      expect(field.getValue()).toBeUndefined()
      expect(field.reason).toBe('insufficient privileges')
    })

    it('should default deny for unknown status', async () => {
      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'secret' }
      const resolver: PolicyResolver = () => ({
        status: 'unknown' as any
      })

      const field = await applySinglePolicy(dbValue, {}, resolver, 'test')

      expect(field.status).toBe('hidden')
      expect(field.reason).toBe('unknown status')
    })

    it('should use context-aware policy', async () => {
      type UserCtx = { role: 'admin' | 'user'; userId: string }

      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'confidential' }
      const resolver: PolicyResolver<UserCtx> = ({ ctx }) => {
        if (ctx.role === 'admin') {
          return { status: 'full' }
        }
        return { status: 'hidden', reason: 'admin only' }
      }

      // Admin gets full access
      const adminCtx: UserCtx = { role: 'admin', userId: 'admin1' }
      const adminField = await applySinglePolicy(dbValue, adminCtx, resolver)
      expect(adminField.status).toBe('full')

      // User gets denied
      const userCtx: UserCtx = { role: 'user', userId: 'user1' }
      const userField = await applySinglePolicy(dbValue, userCtx, resolver)
      expect(userField.status).toBe('hidden')
      expect(userField.reason).toBe('admin only')
    })
  })

  describe('Wire serialization', () => {
    it('should serialize full field to wire', () => {
      const field = SensitiveField.full('secret123', 'password')

      const wire = field.toWire()

      expect(wire).toEqual({
        __sensitiveField: 'password',
        status: 'full',
        value: 'secret123'
      })
    })

    it('should serialize masked field to wire with reason', () => {
      const field = SensitiveField.masked('***-**-6789', 'ssn', 'limited access')

      const wire = field.toWire()

      expect(wire).toEqual({
        __sensitiveField: 'ssn',
        status: 'masked',
        value: '***-**-6789',
        reason: 'limited access'
      })
    })

    it('should serialize hidden field to wire with null value', () => {
      const field = SensitiveField.hidden<string>('secret', 'access denied')

      const wire = field.toWire()

      expect(wire).toEqual({
        __sensitiveField: 'secret',
        status: 'hidden',
        value: null,
        reason: 'access denied'
      })
    })
  })

  describe('Client deserialization', () => {
    it('should deserialize full field from wire', () => {
      const wire: SensitiveWire = {
        __sensitiveField: 'email',
        status: 'full',
        value: 'user@example.com'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.status).toBe('full')
      expect(field.field).toBe('email')
      expect(field.unwrap()).toBe('user@example.com')
    })

    it('should deserialize masked field from wire', () => {
      const wire: SensitiveWire = {
        __sensitiveField: 'phone',
        status: 'masked',
        value: '***-***-1234',
        reason: 'partial access'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.status).toBe('masked')
      expect(field.getValue()).toBe('***-***-1234')
      expect(field.reason).toBe('partial access')
      expect(() => field.unwrap()).toThrow('Cannot unwrap masked SensitiveField')
    })

    it('should deserialize hidden field from wire', () => {
      const wire: SensitiveWire = {
        __sensitiveField: 'ssn',
        status: 'hidden',
        value: null,
        reason: 'no access'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.status).toBe('hidden')
      expect(field.getValue()).toBeUndefined()
      expect(field.reason).toBe('no access')
      expect(() => field.unwrap()).toThrow('Cannot unwrap hidden SensitiveField')
    })
  })

  describe('End-to-end flow', () => {
    it('should complete full cycle: DB → policy → wire → client', async () => {
      // 1. Start with DB value
      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'john@example.com' }

      // 2. Apply policy on server
      const resolver: PolicyResolver<{ role: string }> = ({ ctx }) => {
        if (ctx.role === 'admin') return { status: 'full' }
        return {
          status: 'masked',
          mask: (v) => String(v).replace(/^(.{2}).*(@.*)$/, '$1***$2'),
          reason: 'email partially hidden'
        }
      }

      const serverField = await applySinglePolicy(
        dbValue,
        { role: 'user' },
        resolver,
        'email'
      )

      // 3. Serialize for wire transport
      const wire = serverField.toWire()

      expect(wire.status).toBe('masked')
      expect(wire.value).toBe('jo***@example.com')

      // 4. Client deserializes
      const clientField = SensitiveField.fromWire<string>(wire)

      expect(clientField.status).toBe('masked')
      expect(clientField.getValue()).toBe('jo***@example.com')
      expect(clientField.field).toBe('email')
      expect(clientField.reason).toBe('email partially hidden')
    })

    it('should apply policy only once (optimization)', async () => {
      let policyCallCount = 0

      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'sensitive-data' }
      const resolver: PolicyResolver = () => {
        policyCallCount++
        return { status: 'full' }
      }

      // Apply policy once
      const field = await applySinglePolicy(dbValue, {}, resolver, 'data')

      // Serialize and deserialize multiple times
      const wire1 = field.toWire()
      const client1 = SensitiveField.fromWire(wire1)
      const wire2 = client1.toWire()
      const client2 = SensitiveField.fromWire(wire2)

      // Policy should only have been called once
      expect(policyCallCount).toBe(1)

      // Data should still be accessible
      expect(client2.unwrap()).toBe('sensitive-data')
    })
  })

  describe('Leak resistance', () => {
    it('should warn and return placeholder on string coercion', () => {
      const field = SensitiveField.full('secret', 'password')

      // Implicit string coercion
      const result = `Value: ${field}`

      expect(result).toBe('Value: [SensitiveField]')
    })

    it('should prevent unwrap on non-full fields', () => {
      const masked = SensitiveField.masked('***', 'field')
      const hidden = SensitiveField.hidden<string>('field')

      expect(() => masked.unwrap()).toThrow()
      expect(() => hidden.unwrap()).toThrow()
    })
  })

  describe('Default deny behavior', () => {
    it('should deny by default when resolver returns invalid status', async () => {
      const dbValue: SensitiveDb<string> = { __sensitiveValue: 'secret' }

      // Resolver returns garbage
      const badResolver: PolicyResolver = () => ({ status: 'invalid-status' as any })
      const field = await applySinglePolicy(dbValue, {}, badResolver)

      expect(field.status).toBe('hidden')
      expect(() => field.unwrap()).toThrow()
    })
  })
})
