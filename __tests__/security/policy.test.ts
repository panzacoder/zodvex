/**
 * Tests for src/security/policy.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests policy resolution functions.
 */

import { describe, expect, it } from 'bun:test'
import { resolveReadPolicy, resolveWritePolicy } from '../../src/security/policy'
import type {
  EntitlementResolver,
  PolicyContext,
  ReadPolicy,
  SensitiveMetadata,
  WritePolicy
} from '../../src/security/types'

// Test context type
type TestCtx = { userId: string; roles: string[] }

// Simple role-based resolver
const roleResolver: EntitlementResolver<TestCtx, string> = (context, requirements) => {
  return context.ctx.roles.includes(requirements)
}

// Helper to create a context
function makeContext<TReq = string>(
  ctx: TestCtx,
  meta: SensitiveMetadata<TReq>,
  operation: 'read' | 'write' = 'read',
  path = 'testField'
): PolicyContext<TestCtx, TReq> {
  return { ctx, path, meta, operation }
}

describe('security/policy.ts', () => {
  describe('resolveReadPolicy()', () => {
    describe('tier matching', () => {
      it('should return first matching tier (full access)', async () => {
        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user' }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['admin'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.status).toBe('full')
      })

      it('should return first matching tier (masked access)', async () => {
        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user' }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['user'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.status).toBe('masked')
      })

      it('should check tiers in order and stop at first match', async () => {
        const checkOrder: string[] = []
        const trackingResolver: EntitlementResolver<TestCtx, string> = (context, req) => {
          checkOrder.push(req)
          return context.ctx.roles.includes(req)
        }

        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'superadmin' },
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user' }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['admin'] }, meta)

        await resolveReadPolicy(context, policy, trackingResolver)

        // Should check superadmin, then admin (match), then stop
        expect(checkOrder).toEqual(['superadmin', 'admin'])
      })
    })

    describe('default deny', () => {
      it('should return hidden status when no tier matches', async () => {
        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user' }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['guest'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.status).toBe('hidden')
      })

      it('should return hidden status for empty policy', async () => {
        const policy: ReadPolicy<string> = []
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['admin'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.status).toBe('hidden')
      })

      it('should include default deny reason when provided', async () => {
        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'admin' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['guest'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver, {
          defaultDenyReason: 'access_denied'
        })

        expect(decision.status).toBe('hidden')
        expect(decision.reason).toBe('access_denied')
      })
    })

    describe('resolver return types', () => {
      it('should handle boolean true from resolver', async () => {
        const boolResolver: EntitlementResolver<TestCtx, string> = () => true

        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'any' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, boolResolver)

        expect(decision.status).toBe('full')
      })

      it('should handle boolean false from resolver', async () => {
        const boolResolver: EntitlementResolver<TestCtx, string> = () => false

        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'any' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, boolResolver)

        expect(decision.status).toBe('hidden')
      })

      it('should handle { ok: true } from resolver', async () => {
        const objResolver: EntitlementResolver<TestCtx, string> = () => ({
          ok: true,
          reason: 'passed'
        })

        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'any' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, objResolver)

        expect(decision.status).toBe('full')
      })

      it('should handle { ok: false } from resolver', async () => {
        const objResolver: EntitlementResolver<TestCtx, string> = () => ({
          ok: false,
          reason: 'custom_deny'
        })

        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'any' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, objResolver)

        expect(decision.status).toBe('hidden')
      })

      it('should handle async resolver', async () => {
        const asyncResolver: EntitlementResolver<TestCtx, string> = async () => {
          await Promise.resolve()
          return true
        }

        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'any' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, asyncResolver)

        expect(decision.status).toBe('full')
      })
    })

    describe('reason precedence', () => {
      it('should use tier reason when resolver returns boolean', async () => {
        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin', reason: 'tier_reason' }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['admin'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.reason).toBe('tier_reason')
      })

      it('should prefer resolver reason over tier reason', async () => {
        const reasonResolver: EntitlementResolver<TestCtx, string> = () => ({
          ok: true,
          reason: 'resolver_reason'
        })

        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin', reason: 'tier_reason' }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, reasonResolver)

        expect(decision.reason).toBe('resolver_reason')
      })

      it('should use default deny reason when no tier matches', async () => {
        const policy: ReadPolicy<string> = [{ status: 'full', requirements: 'admin' }]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver, {
          defaultDenyReason: 'default_deny'
        })

        expect(decision.reason).toBe('default_deny')
      })
    })

    describe('mask function handling', () => {
      it('should include mask function in decision for masked tier', async () => {
        const maskFn = (v: unknown) => '***'
        const policy: ReadPolicy<string> = [
          { status: 'masked', requirements: 'user', mask: maskFn }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['user'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.status).toBe('masked')
        expect(decision.mask).toBe(maskFn)
      })

      it('should not include mask function for full access', async () => {
        const maskFn = (v: unknown) => '***'
        const policy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user', mask: maskFn }
        ]
        const meta: SensitiveMetadata<string> = { sensitive: true, read: policy }
        const context = makeContext({ userId: 'u1', roles: ['admin'] }, meta)

        const decision = await resolveReadPolicy(context, policy, roleResolver)

        expect(decision.status).toBe('full')
        expect(decision.mask).toBeUndefined()
      })
    })

    describe('complex requirements', () => {
      it('should pass complex requirements to resolver', async () => {
        type Req = { role: string; permission: string }
        const complexResolver: EntitlementResolver<TestCtx, Req> = (context, req) => {
          return context.ctx.roles.includes(req.role)
        }

        const policy: ReadPolicy<Req> = [
          { status: 'full', requirements: { role: 'admin', permission: 'read:all' } }
        ]
        const meta: SensitiveMetadata<Req> = { sensitive: true, read: policy }
        const context = makeContext<Req>({ userId: 'u1', roles: ['admin'] }, meta)

        const decision = await resolveReadPolicy(context, policy, complexResolver)

        expect(decision.status).toBe('full')
      })
    })
  })

  describe('resolveWritePolicy()', () => {
    describe('basic behavior', () => {
      it('should allow write when requirements are met', async () => {
        const policy: WritePolicy<string> = { requirements: 'admin' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: ['admin'] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, roleResolver)

        expect(decision.allowed).toBe(true)
      })

      it('should deny write when requirements are not met', async () => {
        const policy: WritePolicy<string> = { requirements: 'admin' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: ['user'] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, roleResolver)

        expect(decision.allowed).toBe(false)
      })

      it('should allow write when policy is undefined (default allow)', async () => {
        const meta: SensitiveMetadata<string> = { sensitive: true }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, undefined, roleResolver)

        expect(decision.allowed).toBe(true)
      })
    })

    describe('resolver return types', () => {
      it('should handle boolean true from resolver', async () => {
        const boolResolver: EntitlementResolver<TestCtx, string> = () => true
        const policy: WritePolicy<string> = { requirements: 'any' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, boolResolver)

        expect(decision.allowed).toBe(true)
      })

      it('should handle boolean false from resolver', async () => {
        const boolResolver: EntitlementResolver<TestCtx, string> = () => false
        const policy: WritePolicy<string> = { requirements: 'any' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, boolResolver)

        expect(decision.allowed).toBe(false)
      })

      it('should handle { ok: true } from resolver', async () => {
        const objResolver: EntitlementResolver<TestCtx, string> = () => ({ ok: true })
        const policy: WritePolicy<string> = { requirements: 'any' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, objResolver)

        expect(decision.allowed).toBe(true)
      })

      it('should handle { ok: false, reason } from resolver', async () => {
        const objResolver: EntitlementResolver<TestCtx, string> = () => ({
          ok: false,
          reason: 'custom_deny'
        })
        const policy: WritePolicy<string> = { requirements: 'any' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, objResolver)

        expect(decision.allowed).toBe(false)
        expect(decision.reason).toBe('custom_deny')
      })

      it('should handle async resolver', async () => {
        const asyncResolver: EntitlementResolver<TestCtx, string> = async () => {
          await Promise.resolve()
          return true
        }
        const policy: WritePolicy<string> = { requirements: 'any' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, asyncResolver)

        expect(decision.allowed).toBe(true)
      })
    })

    describe('reason handling', () => {
      it('should include policy reason on denial', async () => {
        const policy: WritePolicy<string> = {
          requirements: 'admin',
          reason: 'admin_only_field'
        }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: ['user'] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, roleResolver)

        expect(decision.allowed).toBe(false)
        expect(decision.reason).toBe('admin_only_field')
      })

      it('should prefer resolver reason over policy reason', async () => {
        const reasonResolver: EntitlementResolver<TestCtx, string> = () => ({
          ok: false,
          reason: 'resolver_reason'
        })
        const policy: WritePolicy<string> = {
          requirements: 'admin',
          reason: 'policy_reason'
        }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, reasonResolver)

        expect(decision.reason).toBe('resolver_reason')
      })

      it('should use default deny reason when resolver gives no reason', async () => {
        const policy: WritePolicy<string> = { requirements: 'admin' }
        const meta: SensitiveMetadata<string> = { sensitive: true, write: policy }
        const context = makeContext({ userId: 'u1', roles: [] }, meta, 'write')

        const decision = await resolveWritePolicy(context, policy, roleResolver, {
          defaultDenyReason: 'default_write_deny'
        })

        expect(decision.allowed).toBe(false)
        expect(decision.reason).toBe('default_write_deny')
      })
    })
  })
})
