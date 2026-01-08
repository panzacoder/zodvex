/**
 * Tests for src/security/types.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 */

import { describe, expect, it } from 'bun:test'
import type {
  EntitlementCheckResult,
  EntitlementResolver,
  PolicyContext,
  ReadDecision,
  ReadPolicy,
  ReadPolicyTier,
  ReasonCode,
  SensitiveDb,
  SensitiveMetadata,
  SensitiveStatus,
  SensitiveWire,
  WriteDecision,
  WritePolicy
} from '../../src/security/types'

describe('security/types.ts', () => {
  describe('SensitiveDb<T>', () => {
    it('should type the DB storage shape correctly', () => {
      const dbValue: SensitiveDb<string> = {
        __sensitiveValue: 'secret@example.com'
      }
      expect(dbValue.__sensitiveValue).toBe('secret@example.com')
    })

    it('should support optional checksum and algo', () => {
      const dbValueWithChecksum: SensitiveDb<string> = {
        __sensitiveValue: 'secret',
        __checksum: 'abc123',
        __algo: 'sha256'
      }
      expect(dbValueWithChecksum.__checksum).toBe('abc123')
      expect(dbValueWithChecksum.__algo).toBe('sha256')
    })

    it('should support various inner types', () => {
      const numberValue: SensitiveDb<number> = { __sensitiveValue: 42 }
      const boolValue: SensitiveDb<boolean> = { __sensitiveValue: true }
      const objectValue: SensitiveDb<{ ssn: string }> = {
        __sensitiveValue: { ssn: '123-45-6789' }
      }

      expect(numberValue.__sensitiveValue).toBe(42)
      expect(boolValue.__sensitiveValue).toBe(true)
      expect(objectValue.__sensitiveValue.ssn).toBe('123-45-6789')
    })
  })

  describe('SensitiveStatus', () => {
    it('should allow full, masked, and hidden values', () => {
      const full: SensitiveStatus = 'full'
      const masked: SensitiveStatus = 'masked'
      const hidden: SensitiveStatus = 'hidden'

      expect(full).toBe('full')
      expect(masked).toBe('masked')
      expect(hidden).toBe('hidden')
    })
  })

  describe('SensitiveWire<T>', () => {
    it('should type the wire format for full access', () => {
      const wire: SensitiveWire<string> = {
        status: 'full',
        value: 'secret@example.com'
      }
      expect(wire.status).toBe('full')
      expect(wire.value).toBe('secret@example.com')
    })

    it('should type the wire format for masked access', () => {
      const wire: SensitiveWire<string> = {
        status: 'masked',
        value: 's****@example.com',
        reason: 'insufficient_permissions'
      }
      expect(wire.status).toBe('masked')
      expect(wire.value).toBe('s****@example.com')
      expect(wire.reason).toBe('insufficient_permissions')
    })

    it('should type the wire format for hidden access', () => {
      const wire: SensitiveWire<string> = {
        status: 'hidden',
        value: null,
        reason: 'access_denied'
      }
      expect(wire.status).toBe('hidden')
      expect(wire.value).toBeNull()
      expect(wire.reason).toBe('access_denied')
    })

    it('should support optional __sensitiveField marker', () => {
      const wire: SensitiveWire<string> = {
        __sensitiveField: 'email',
        status: 'full',
        value: 'test@example.com'
      }
      expect(wire.__sensitiveField).toBe('email')
    })
  })

  describe('ReadPolicyTier<TReq>', () => {
    it('should define a policy tier with requirements', () => {
      const tier: ReadPolicyTier<string> = {
        status: 'full',
        requirements: 'admin'
      }
      expect(tier.status).toBe('full')
      expect(tier.requirements).toBe('admin')
    })

    it('should support mask function', () => {
      const maskFn = (v: unknown) => String(v).replace(/./g, '*')
      const tier: ReadPolicyTier<string[]> = {
        status: 'masked',
        requirements: ['user', 'viewer'],
        mask: maskFn
      }
      expect(tier.mask).toBe(maskFn)
      expect(tier.mask?.('secret')).toBe('******')
    })

    it('should support reason code', () => {
      const tier: ReadPolicyTier<{ role: string }> = {
        status: 'full',
        requirements: { role: 'admin' },
        reason: 'admin_access_granted'
      }
      expect(tier.reason).toBe('admin_access_granted')
    })
  })

  describe('ReadPolicy<TReq>', () => {
    it('should be an array of ReadPolicyTier', () => {
      const policy: ReadPolicy<string> = [
        { status: 'full', requirements: 'admin' },
        { status: 'masked', requirements: 'user', mask: v => '***' },
        { status: 'masked', requirements: 'viewer' }
      ]
      expect(policy).toHaveLength(3)
      expect(policy[0].status).toBe('full')
      expect(policy[1].status).toBe('masked')
    })
  })

  describe('WritePolicy<TReq>', () => {
    it('should define write requirements', () => {
      const policy: WritePolicy<string> = {
        requirements: 'admin'
      }
      expect(policy.requirements).toBe('admin')
    })

    it('should support reason code', () => {
      const policy: WritePolicy<string[]> = {
        requirements: ['admin', 'superuser'],
        reason: 'write_requires_elevated_permissions'
      }
      expect(policy.reason).toBe('write_requires_elevated_permissions')
    })
  })

  describe('SensitiveMetadata<TReq>', () => {
    it('should have sensitive: true', () => {
      const meta: SensitiveMetadata = {
        sensitive: true
      }
      expect(meta.sensitive).toBe(true)
    })

    it('should support read and write policies', () => {
      const meta: SensitiveMetadata<string> = {
        sensitive: true,
        read: [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user' }
        ],
        write: { requirements: 'admin' }
      }
      expect(meta.read).toHaveLength(2)
      expect(meta.write?.requirements).toBe('admin')
    })
  })

  describe('ReadDecision', () => {
    it('should represent full access decision', () => {
      const decision: ReadDecision = {
        status: 'full'
      }
      expect(decision.status).toBe('full')
    })

    it('should represent masked access decision with mask function', () => {
      const maskFn = (v: unknown) => '***'
      const decision: ReadDecision = {
        status: 'masked',
        mask: maskFn,
        reason: 'partial_access'
      }
      expect(decision.status).toBe('masked')
      expect(decision.mask).toBe(maskFn)
      expect(decision.reason).toBe('partial_access')
    })

    it('should represent hidden decision', () => {
      const decision: ReadDecision = {
        status: 'hidden',
        reason: 'access_denied'
      }
      expect(decision.status).toBe('hidden')
      expect(decision.reason).toBe('access_denied')
    })
  })

  describe('WriteDecision', () => {
    it('should represent allowed write', () => {
      const decision: WriteDecision = {
        allowed: true
      }
      expect(decision.allowed).toBe(true)
    })

    it('should represent denied write with reason', () => {
      const decision: WriteDecision = {
        allowed: false,
        reason: 'insufficient_permissions'
      }
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('insufficient_permissions')
    })
  })

  describe('EntitlementCheckResult', () => {
    it('should support boolean result', () => {
      const result1: EntitlementCheckResult = true
      const result2: EntitlementCheckResult = false
      expect(result1).toBe(true)
      expect(result2).toBe(false)
    })

    it('should support object result with ok and reason', () => {
      const result: EntitlementCheckResult = {
        ok: false,
        reason: 'missing_role'
      }
      expect(typeof result).toBe('object')
      if (typeof result === 'object') {
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('missing_role')
      }
    })
  })

  describe('PolicyContext<TCtx, TReq, TDoc>', () => {
    it('should contain all context needed for policy resolution', () => {
      type MyCtx = { userId: string; roles: string[] }
      type MyReq = string
      type MyDoc = { _id: string; ownerId: string }

      const context: PolicyContext<MyCtx, MyReq, MyDoc> = {
        ctx: { userId: 'user123', roles: ['admin'] },
        path: 'email',
        meta: {
          sensitive: true,
          read: [{ status: 'full', requirements: 'admin' }]
        },
        doc: { _id: 'doc123', ownerId: 'user123' },
        operation: 'read'
      }

      expect(context.ctx.userId).toBe('user123')
      expect(context.path).toBe('email')
      expect(context.meta.sensitive).toBe(true)
      expect(context.doc?._id).toBe('doc123')
      expect(context.operation).toBe('read')
    })

    it('should support write operation', () => {
      const context: PolicyContext<{ userId: string }, string> = {
        ctx: { userId: 'user123' },
        path: 'ssn',
        meta: { sensitive: true, write: { requirements: 'admin' } },
        operation: 'write'
      }
      expect(context.operation).toBe('write')
    })
  })

  describe('EntitlementResolver<TCtx, TReq, TDoc>', () => {
    it('should be a function that takes context and requirements', async () => {
      type MyCtx = { roles: string[] }
      type MyReq = string

      const resolver: EntitlementResolver<MyCtx, MyReq> = (context, requirements) => {
        return context.ctx.roles.includes(requirements)
      }

      const context: PolicyContext<MyCtx, MyReq> = {
        ctx: { roles: ['admin', 'user'] },
        path: 'email',
        meta: { sensitive: true },
        operation: 'read'
      }

      expect(resolver(context, 'admin')).toBe(true)
      expect(resolver(context, 'superuser')).toBe(false)
    })

    it('should support async resolvers', async () => {
      type MyCtx = { userId: string }
      type MyReq = { permission: string }

      const asyncResolver: EntitlementResolver<MyCtx, MyReq> = async (context, requirements) => {
        // Simulate async permission check
        await Promise.resolve()
        return { ok: true, reason: 'permission_granted' }
      }

      const context: PolicyContext<MyCtx, MyReq> = {
        ctx: { userId: 'user123' },
        path: 'ssn',
        meta: { sensitive: true },
        operation: 'read'
      }

      const result = await asyncResolver(context, { permission: 'read:ssn' })
      expect(typeof result).toBe('object')
      if (typeof result === 'object') {
        expect(result.ok).toBe(true)
        expect(result.reason).toBe('permission_granted')
      }
    })

    it('should have access to doc in context', () => {
      type MyCtx = { userId: string }
      type MyDoc = { ownerId: string }

      const ownerResolver: EntitlementResolver<MyCtx, 'owner', MyDoc> = (context, requirements) => {
        if (requirements === 'owner' && context.doc) {
          return context.ctx.userId === context.doc.ownerId
        }
        return false
      }

      const contextOwner: PolicyContext<MyCtx, 'owner', MyDoc> = {
        ctx: { userId: 'user123' },
        path: 'email',
        meta: { sensitive: true },
        doc: { ownerId: 'user123' },
        operation: 'read'
      }

      const contextNonOwner: PolicyContext<MyCtx, 'owner', MyDoc> = {
        ctx: { userId: 'user456' },
        path: 'email',
        meta: { sensitive: true },
        doc: { ownerId: 'user123' },
        operation: 'read'
      }

      expect(ownerResolver(contextOwner, 'owner')).toBe(true)
      expect(ownerResolver(contextNonOwner, 'owner')).toBe(false)
    })
  })

  describe('ReasonCode', () => {
    it('should be a string type', () => {
      const reason: ReasonCode = 'access_denied'
      expect(typeof reason).toBe('string')
    })
  })
})
