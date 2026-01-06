/**
 * Tests for src/security/apply-policy.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests recursive transforms for read and write policies.
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  applyReadPolicy,
  assertWriteAllowed,
  validateWritePolicy,
  type WriteValidationResult
} from '../../src/security/apply-policy'
import { sensitive } from '../../src/security/sensitive'
import type { EntitlementResolver, SensitiveDb } from '../../src/security/types'

// Test context type
type TestCtx = { userId: string; roles: string[] }

// Simple role-based resolver
const roleResolver: EntitlementResolver<TestCtx, string> = (context, requirements) => {
  return context.ctx.roles.includes(requirements)
}

// Admin context
const adminCtx: TestCtx = { userId: 'admin1', roles: ['admin', 'user'] }

// Regular user context
const userCtx: TestCtx = { userId: 'user1', roles: ['user'] }

// Guest context (no roles)
const guestCtx: TestCtx = { userId: 'guest1', roles: [] }

// Helper to create sensitive DB value
function sensitiveDb<T>(value: T): SensitiveDb<T> {
  return { __sensitiveValue: value }
}

describe('security/apply-policy.ts', () => {
  describe('applyReadPolicy()', () => {
    describe('flat objects', () => {
      it('should return full value when user has full access', async () => {
        const schema = z.object({
          name: z.string(),
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          })
        })

        const value = {
          name: 'Test User',
          email: sensitiveDb('test@example.com')
        }

        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.name).toBe('Test User')
        expect(result.email).toEqual({
          status: 'full',
          value: 'test@example.com'
        })
      })

      it('should return masked value when user has masked access', async () => {
        const maskFn = (v: unknown) => String(v).replace(/(?<=.).(?=.*@)/g, '*')
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [
              { status: 'full', requirements: 'admin' },
              { status: 'masked', requirements: 'user', mask: maskFn }
            ]
          })
        })

        const value = { email: sensitiveDb('test@example.com') }
        const result = await applyReadPolicy(value, schema, userCtx, roleResolver)

        expect(result.email.status).toBe('masked')
        expect(result.email.value).toBe('t***@example.com')
      })

      it('should return hidden value when user has no access', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          })
        })

        const value = { email: sensitiveDb('test@example.com') }
        const result = await applyReadPolicy(value, schema, guestCtx, roleResolver)

        expect(result.email.status).toBe('hidden')
        expect(result.email.value).toBeNull()
      })

      it('should pass through non-sensitive fields unchanged', async () => {
        const schema = z.object({
          name: z.string(),
          age: z.number(),
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          })
        })

        const value = {
          name: 'Test User',
          age: 30,
          email: sensitiveDb('test@example.com')
        }

        const result = await applyReadPolicy(value, schema, guestCtx, roleResolver)

        expect(result.name).toBe('Test User')
        expect(result.age).toBe(30)
        expect(result.email.status).toBe('hidden')
      })

      it('should handle multiple sensitive fields with different policies', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'user' }]
          }),
          ssn: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          })
        })

        const value = {
          email: sensitiveDb('test@example.com'),
          ssn: sensitiveDb('123-45-6789')
        }

        const result = await applyReadPolicy(value, schema, userCtx, roleResolver)

        expect(result.email.status).toBe('full')
        expect(result.ssn.status).toBe('hidden')
      })
    })

    describe('nested objects', () => {
      it('should handle sensitive fields in nested objects', async () => {
        const schema = z.object({
          profile: z.object({
            email: sensitive(z.string(), {
              read: [{ status: 'full', requirements: 'admin' }]
            })
          })
        })

        const value = {
          profile: {
            email: sensitiveDb('test@example.com')
          }
        }

        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.profile.email.status).toBe('full')
        expect(result.profile.email.value).toBe('test@example.com')
      })

      it('should handle deeply nested sensitive fields', async () => {
        const schema = z.object({
          level1: z.object({
            level2: z.object({
              secret: sensitive(z.string(), {
                read: [{ status: 'full', requirements: 'admin' }]
              })
            })
          })
        })

        const value = {
          level1: {
            level2: {
              secret: sensitiveDb('deep secret')
            }
          }
        }

        const result = await applyReadPolicy(value, schema, guestCtx, roleResolver)

        expect(result.level1.level2.secret.status).toBe('hidden')
      })
    })

    describe('optional fields', () => {
      it('should handle optional sensitive fields when present', async () => {
        const schema = z.object({
          phone: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          }).optional()
        })

        const value = { phone: sensitiveDb('+1234567890') }
        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.phone?.status).toBe('full')
        expect(result.phone?.value).toBe('+1234567890')
      })

      it('should handle optional sensitive fields when undefined', async () => {
        const schema = z.object({
          phone: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          }).optional()
        })

        const value = { phone: undefined }
        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.phone).toBeUndefined()
      })
    })

    describe('arrays', () => {
      it('should handle arrays of objects with sensitive fields', async () => {
        const schema = z.object({
          contacts: z.array(
            z.object({
              email: sensitive(z.string(), {
                read: [{ status: 'full', requirements: 'admin' }]
              })
            })
          )
        })

        const value = {
          contacts: [
            { email: sensitiveDb('a@example.com') },
            { email: sensitiveDb('b@example.com') }
          ]
        }

        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.contacts).toHaveLength(2)
        expect(result.contacts[0].email.status).toBe('full')
        expect(result.contacts[1].email.value).toBe('b@example.com')
      })

      it('should handle arrays of sensitive values', async () => {
        const schema = z.object({
          secretCodes: z.array(
            sensitive(z.string(), {
              read: [{ status: 'full', requirements: 'admin' }]
            })
          )
        })

        const value = {
          secretCodes: [sensitiveDb('CODE1'), sensitiveDb('CODE2')]
        }

        const result = await applyReadPolicy(value, schema, guestCtx, roleResolver)

        expect(result.secretCodes).toHaveLength(2)
        expect(result.secretCodes[0].status).toBe('hidden')
        expect(result.secretCodes[1].status).toBe('hidden')
      })
    })

    describe('unions', () => {
      it('should handle unions with sensitive fields', async () => {
        const schema = z.union([
          z.object({
            type: z.literal('user'),
            email: sensitive(z.string(), {
              read: [{ status: 'full', requirements: 'admin' }]
            })
          }),
          z.object({
            type: z.literal('anon'),
            sessionId: z.string()
          })
        ])

        const value = {
          type: 'user' as const,
          email: sensitiveDb('test@example.com')
        }

        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.email.status).toBe('full')
      })
    })

    describe('discriminated unions', () => {
      it('should handle discriminated unions with sensitive fields', async () => {
        const schema = z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('patient'),
            ssn: sensitive(z.string(), {
              read: [{ status: 'full', requirements: 'admin' }]
            })
          }),
          z.object({
            kind: z.literal('provider'),
            npi: sensitive(z.string(), {
              read: [{ status: 'full', requirements: 'admin' }]
            })
          })
        ])

        const patientValue = {
          kind: 'patient' as const,
          ssn: sensitiveDb('123-45-6789')
        }

        const result = await applyReadPolicy(patientValue, schema, guestCtx, roleResolver)

        expect(result.ssn.status).toBe('hidden')
      })
    })

    describe('fail-closed behavior', () => {
      it('should redact unmatched union values (fail-closed)', async () => {
        const schema = z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('patient'),
            ssn: sensitive(z.string(), {
              read: [{ status: 'full', requirements: 'admin' }]
            })
          }),
          z.object({
            kind: z.literal('provider'),
            npi: z.string()
          })
        ])

        // Value doesn't match any variant (invalid discriminator)
        const invalidValue = {
          kind: 'unknown' as any,
          secret: sensitiveDb('should be redacted')
        }

        const result = await applyReadPolicy(invalidValue, schema, adminCtx, roleResolver)

        // Should fail-closed - entire value should be redacted
        expect(result).toBeNull()
      })

      it('should call onFailClosed callback when union fails to match', async () => {
        const failedPaths: string[] = []
        const schema = z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('a'),
            value: z.string()
          })
        ])

        const invalidValue = { kind: 'invalid' as any }

        await applyReadPolicy(invalidValue, schema, adminCtx, roleResolver, {
          onFailClosed: (path, reason) => failedPaths.push(path)
        })

        expect(failedPaths.length).toBeGreaterThan(0)
      })
    })

    describe('options', () => {
      it('should include reason in transformed output', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin', reason: 'admin_access' }]
          })
        })

        const value = { email: sensitiveDb('test@example.com') }
        const result = await applyReadPolicy(value, schema, adminCtx, roleResolver)

        expect(result.email.reason).toBe('admin_access')
      })

      it('should use defaultDenyReason when access is denied', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
          })
        })

        const value = { email: sensitiveDb('test@example.com') }
        const result = await applyReadPolicy(value, schema, guestCtx, roleResolver, {
          defaultDenyReason: 'access_denied'
        })

        expect(result.email.reason).toBe('access_denied')
      })
    })
  })

  describe('validateWritePolicy()', () => {
    describe('basic validation', () => {
      it('should allow writes when all policies pass', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            write: { requirements: 'admin' }
          })
        })

        const value = { email: sensitiveDb('new@example.com') }
        const result = await validateWritePolicy(value, schema, adminCtx, roleResolver)

        expect(result.allowed).toBe(true)
        expect(result.deniedFields).toHaveLength(0)
      })

      it('should deny writes when policy fails', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            write: { requirements: 'admin' }
          })
        })

        const value = { email: sensitiveDb('new@example.com') }
        const result = await validateWritePolicy(value, schema, userCtx, roleResolver)

        expect(result.allowed).toBe(false)
        expect(result.deniedFields).toHaveLength(1)
        expect(result.deniedFields[0].path).toBe('email')
      })

      it('should return all denied fields, not just first', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            write: { requirements: 'admin' }
          }),
          ssn: sensitive(z.string(), {
            write: { requirements: 'admin' }
          }),
          name: z.string()
        })

        const value = {
          email: sensitiveDb('new@example.com'),
          ssn: sensitiveDb('123-45-6789'),
          name: 'Test'
        }
        const result = await validateWritePolicy(value, schema, userCtx, roleResolver)

        expect(result.allowed).toBe(false)
        expect(result.deniedFields).toHaveLength(2)
        const paths = result.deniedFields.map((f) => f.path)
        expect(paths).toContain('email')
        expect(paths).toContain('ssn')
      })

      it('should include reasons for denied fields', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            write: { requirements: 'admin', reason: 'admin_only_field' }
          })
        })

        const value = { email: sensitiveDb('new@example.com') }
        const result = await validateWritePolicy(value, schema, userCtx, roleResolver)

        expect(result.deniedFields[0].reason).toBe('admin_only_field')
      })
    })

    describe('no write policy (default allow)', () => {
      it('should allow writes when no write policy is defined', async () => {
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: 'admin' }]
            // No write policy
          })
        })

        const value = { email: sensitiveDb('new@example.com') }
        const result = await validateWritePolicy(value, schema, guestCtx, roleResolver)

        expect(result.allowed).toBe(true)
      })
    })

    describe('nested objects', () => {
      it('should validate nested sensitive fields', async () => {
        const schema = z.object({
          profile: z.object({
            email: sensitive(z.string(), {
              write: { requirements: 'admin' }
            })
          })
        })

        const value = {
          profile: {
            email: sensitiveDb('new@example.com')
          }
        }
        const result = await validateWritePolicy(value, schema, userCtx, roleResolver)

        expect(result.allowed).toBe(false)
        expect(result.deniedFields[0].path).toBe('profile.email')
      })
    })

    describe('arrays', () => {
      it('should validate sensitive fields in arrays', async () => {
        const schema = z.object({
          contacts: z.array(
            z.object({
              email: sensitive(z.string(), {
                write: { requirements: 'admin' }
              })
            })
          )
        })

        const value = {
          contacts: [
            { email: sensitiveDb('a@example.com') },
            { email: sensitiveDb('b@example.com') }
          ]
        }
        const result = await validateWritePolicy(value, schema, userCtx, roleResolver)

        expect(result.allowed).toBe(false)
        expect(result.deniedFields.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('assertWriteAllowed()', () => {
    it('should not throw when all writes are allowed', async () => {
      const schema = z.object({
        email: sensitive(z.string(), {
          write: { requirements: 'admin' }
        })
      })

      const value = { email: sensitiveDb('new@example.com') }

      // Should not throw
      await expect(
        assertWriteAllowed(value, schema, adminCtx, roleResolver)
      ).resolves.toBeUndefined()
    })

    it('should throw when any write is denied', async () => {
      const schema = z.object({
        email: sensitive(z.string(), {
          write: { requirements: 'admin' }
        })
      })

      const value = { email: sensitiveDb('new@example.com') }

      await expect(assertWriteAllowed(value, schema, userCtx, roleResolver)).rejects.toThrow()
    })

    it('should include denied field paths in error message', async () => {
      const schema = z.object({
        email: sensitive(z.string(), {
          write: { requirements: 'admin' }
        }),
        ssn: sensitive(z.string(), {
          write: { requirements: 'admin' }
        })
      })

      const value = {
        email: sensitiveDb('new@example.com'),
        ssn: sensitiveDb('123-45-6789')
      }

      try {
        await assertWriteAllowed(value, schema, userCtx, roleResolver)
        expect.unreachable('Should have thrown')
      } catch (e) {
        expect(String(e)).toContain('email')
        expect(String(e)).toContain('ssn')
      }
    })
  })
})
