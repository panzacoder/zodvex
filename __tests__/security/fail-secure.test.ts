/**
 * Tests for src/security/fail-secure.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests fail-secure defaults:
 * - autoLimit() - auto-limit all sensitive fields to hidden
 * - assertNoSensitive() - throw if schema contains sensitive fields
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { autoLimit, assertNoSensitive } from '../../src/security/fail-secure'
import { sensitive } from '../../src/security/sensitive'
import type { SensitiveDb } from '../../src/security/types'

// Helper to create SensitiveDb value
function sensitiveDb<T>(value: T): SensitiveDb<T> {
  return { __sensitiveValue: value }
}

describe('security/fail-secure.ts', () => {
  describe('autoLimit()', () => {
    describe('basic behavior', () => {
      it('should convert all sensitive fields to hidden status', () => {
        const schema = z.object({
          name: z.string(),
          email: sensitive(z.string())
        })

        const value = {
          name: 'John',
          email: sensitiveDb('john@example.com')
        }

        const result = autoLimit(value, schema)

        expect(result.name).toBe('John')
        expect(result.email.status).toBe('hidden')
        expect(result.email.value).toBeNull()
      })

      it('should pass through non-sensitive fields unchanged', () => {
        const schema = z.object({
          name: z.string(),
          age: z.number(),
          active: z.boolean()
        })

        const value = {
          name: 'John',
          age: 30,
          active: true
        }

        const result = autoLimit(value, schema)

        expect(result).toEqual(value)
      })

      it('should include default reason for hidden fields', () => {
        const schema = z.object({
          email: sensitive(z.string())
        })

        const value = { email: sensitiveDb('test@example.com') }

        const result = autoLimit(value, schema, { defaultReason: 'auto_limited' })

        expect(result.email.reason).toBe('auto_limited')
      })

      it('should throw on orphaned SensitiveDb values by default (Option 4 safety net)', () => {
        const schema = z.object({
          // Not marked sensitive
          email: z.string()
        })

        const value = { email: sensitiveDb('test@example.com') }

        expect(() => autoLimit(value, schema)).toThrow(/schema is not marked sensitive/i)
      })
    })

    describe('nested objects', () => {
      it('should auto-limit sensitive fields in nested objects', () => {
        const schema = z.object({
          profile: z.object({
            email: sensitive(z.string()),
            phone: z.string()
          })
        })

        const value = {
          profile: {
            email: sensitiveDb('test@example.com'),
            phone: '555-1234'
          }
        }

        const result = autoLimit(value, schema)

        expect(result.profile.email.status).toBe('hidden')
        expect(result.profile.phone).toBe('555-1234')
      })
    })

    describe('arrays', () => {
      it('should auto-limit sensitive fields in arrays', () => {
        const schema = z.object({
          contacts: z.array(
            z.object({
              email: sensitive(z.string())
            })
          )
        })

        const value = {
          contacts: [
            { email: sensitiveDb('a@example.com') },
            { email: sensitiveDb('b@example.com') }
          ]
        }

        const result = autoLimit(value, schema)

        expect(result.contacts).toHaveLength(2)
        expect(result.contacts[0].email.status).toBe('hidden')
        expect(result.contacts[1].email.status).toBe('hidden')
      })
    })

    describe('optional fields', () => {
      it('should handle optional sensitive fields when present', () => {
        const schema = z.object({
          phone: sensitive(z.string()).optional()
        })

        const value = { phone: sensitiveDb('+1234567890') }

        const result = autoLimit(value, schema)

        expect(result.phone?.status).toBe('hidden')
      })

      it('should handle optional sensitive fields when undefined', () => {
        const schema = z.object({
          phone: sensitive(z.string()).optional()
        })

        const value = { phone: undefined }

        const result = autoLimit(value, schema)

        expect(result.phone).toBeUndefined()
      })
    })

    describe('unions', () => {
      it('should auto-limit sensitive fields in union variants', () => {
        const schema = z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('user'),
            email: sensitive(z.string())
          }),
          z.object({
            kind: z.literal('guest'),
            sessionId: z.string()
          })
        ])

        const userValue = {
          kind: 'user' as const,
          email: sensitiveDb('user@example.com')
        }

        const result = autoLimit(userValue, schema)

        expect(result.email.status).toBe('hidden')
      })
    })
  })

  describe('assertNoSensitive()', () => {
    describe('schemas without sensitive fields', () => {
      it('should not throw for schemas without sensitive fields', () => {
        const schema = z.object({
          name: z.string(),
          age: z.number()
        })

        expect(() => assertNoSensitive(schema)).not.toThrow()
      })

      it('should not throw for primitive schemas', () => {
        expect(() => assertNoSensitive(z.string())).not.toThrow()
        expect(() => assertNoSensitive(z.number())).not.toThrow()
        expect(() => assertNoSensitive(z.boolean())).not.toThrow()
      })
    })

    describe('schemas with sensitive fields', () => {
      it('should throw for schemas with sensitive fields', () => {
        const schema = z.object({
          name: z.string(),
          email: sensitive(z.string())
        })

        expect(() => assertNoSensitive(schema)).toThrow()
      })

      it('should throw for nested sensitive fields', () => {
        const schema = z.object({
          profile: z.object({
            email: sensitive(z.string())
          })
        })

        expect(() => assertNoSensitive(schema)).toThrow()
      })

      it('should throw for sensitive fields in arrays', () => {
        const schema = z.object({
          contacts: z.array(
            z.object({
              email: sensitive(z.string())
            })
          )
        })

        expect(() => assertNoSensitive(schema)).toThrow()
      })

      it('should throw for sensitive fields in unions', () => {
        const schema = z.union([
          z.object({ email: sensitive(z.string()) }),
          z.object({ name: z.string() })
        ])

        expect(() => assertNoSensitive(schema)).toThrow()
      })

      it('should include field paths in error message', () => {
        const schema = z.object({
          profile: z.object({
            email: sensitive(z.string())
          })
        })

        try {
          assertNoSensitive(schema)
          expect.unreachable('Should have thrown')
        } catch (e) {
          expect(String(e)).toContain('profile.email')
        }
      })
    })

    describe('custom error messages', () => {
      it('should use custom error message when provided', () => {
        const schema = z.object({
          email: sensitive(z.string())
        })

        try {
          assertNoSensitive(schema, { message: 'Cannot use sensitive fields in this context' })
          expect.unreachable('Should have thrown')
        } catch (e) {
          expect(String(e)).toContain('Cannot use sensitive fields in this context')
        }
      })
    })
  })
})
