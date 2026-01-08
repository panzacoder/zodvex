/**
 * Tests for src/security/wire.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests wire format serialization/deserialization helpers.
 */

import { describe, expect, it } from 'bun:test'
import { SensitiveField } from '../../src/security/sensitive-field'
import { deserializeFromWire, isSensitiveWire, serializeToWire } from '../../src/security/wire'

describe('security/wire.ts', () => {
  describe('isSensitiveWire()', () => {
    it('should return true for wire format objects', () => {
      const wire = { status: 'full', value: 'test' }
      expect(isSensitiveWire(wire)).toBe(true)
    })

    it('should return true for wire format with all fields', () => {
      const wire = {
        __sensitiveField: 'email',
        status: 'masked',
        value: '***',
        reason: 'limited_access'
      }
      expect(isSensitiveWire(wire)).toBe(true)
    })

    it('should return false for non-wire objects', () => {
      expect(isSensitiveWire({ value: 'test' })).toBe(false)
      expect(isSensitiveWire({ status: 'full' })).toBe(false)
      expect(isSensitiveWire({})).toBe(false)
      expect(isSensitiveWire(null)).toBe(false)
      expect(isSensitiveWire('string')).toBe(false)
      expect(isSensitiveWire(123)).toBe(false)
    })

    it('should return false for SensitiveDb format', () => {
      // SensitiveDb has __sensitiveValue, not status/value
      const dbValue = { __sensitiveValue: 'secret' }
      expect(isSensitiveWire(dbValue)).toBe(false)
    })
  })

  describe('serializeToWire()', () => {
    describe('flat objects', () => {
      it('should serialize SensitiveField values to wire format', () => {
        const obj = {
          name: 'John',
          email: SensitiveField.full('john@example.com', 'email')
        }

        const wire = serializeToWire(obj)

        expect(wire.name).toBe('John')
        expect(wire.email).toEqual({
          __sensitiveField: 'email',
          status: 'full',
          value: 'john@example.com'
        })
      })

      it('should handle multiple SensitiveFields', () => {
        const obj = {
          email: SensitiveField.full('test@example.com', 'email'),
          ssn: SensitiveField.masked('***-**-1234', 'ssn', 'limited'),
          secret: SensitiveField.hidden<string>('secret', 'denied')
        }

        const wire = serializeToWire(obj)

        expect(wire.email.status).toBe('full')
        expect(wire.ssn.status).toBe('masked')
        expect(wire.secret.status).toBe('hidden')
        expect(wire.secret.value).toBeNull()
      })

      it('should pass through non-SensitiveField values unchanged', () => {
        const obj = {
          name: 'John',
          age: 30,
          active: true,
          metadata: { key: 'value' }
        }

        const wire = serializeToWire(obj)

        expect(wire).toEqual(obj)
      })
    })

    describe('nested objects', () => {
      it('should recursively serialize nested SensitiveFields', () => {
        const obj = {
          profile: {
            name: 'John',
            contact: {
              email: SensitiveField.full('john@example.com', 'email')
            }
          }
        }

        const wire = serializeToWire(obj)

        expect(wire.profile.name).toBe('John')
        expect(wire.profile.contact.email.status).toBe('full')
        expect(wire.profile.contact.email.value).toBe('john@example.com')
      })
    })

    describe('arrays', () => {
      it('should serialize arrays of SensitiveFields', () => {
        const obj = {
          emails: [SensitiveField.full('a@example.com'), SensitiveField.full('b@example.com')]
        }

        const wire = serializeToWire(obj)

        expect(wire.emails).toHaveLength(2)
        expect(wire.emails[0].status).toBe('full')
        expect(wire.emails[1].value).toBe('b@example.com')
      })

      it('should serialize arrays of objects with SensitiveFields', () => {
        const obj = {
          contacts: [
            { name: 'John', email: SensitiveField.full('john@example.com') },
            { name: 'Jane', email: SensitiveField.masked('j***@example.com') }
          ]
        }

        const wire = serializeToWire(obj)

        expect(wire.contacts[0].name).toBe('John')
        expect(wire.contacts[0].email.status).toBe('full')
        expect(wire.contacts[1].email.status).toBe('masked')
      })
    })

    describe('null and undefined', () => {
      it('should handle null values', () => {
        const obj = { name: null, email: SensitiveField.full('test@example.com') }

        const wire = serializeToWire(obj)

        expect(wire.name).toBeNull()
        expect(wire.email.status).toBe('full')
      })

      it('should handle undefined values', () => {
        const obj = { name: undefined, email: SensitiveField.full('test@example.com') }

        const wire = serializeToWire(obj)

        expect(wire.name).toBeUndefined()
        expect(wire.email.status).toBe('full')
      })
    })
  })

  describe('deserializeFromWire()', () => {
    describe('flat objects', () => {
      it('should deserialize wire format to SensitiveFields', () => {
        const wire = {
          name: 'John',
          email: { status: 'full' as const, value: 'john@example.com', __sensitiveField: 'email' }
        }

        const obj = deserializeFromWire(wire)

        expect(obj.name).toBe('John')
        expect(obj.email).toBeInstanceOf(SensitiveField)
        expect(obj.email.status).toBe('full')
        expect(obj.email.getValue()).toBe('john@example.com')
      })

      it('should handle multiple wire format fields', () => {
        const wire = {
          email: { status: 'full' as const, value: 'test@example.com' },
          ssn: { status: 'masked' as const, value: '***-**-1234', reason: 'limited' },
          secret: { status: 'hidden' as const, value: null, reason: 'denied' }
        }

        const obj = deserializeFromWire(wire)

        expect(obj.email.status).toBe('full')
        expect(obj.ssn.status).toBe('masked')
        expect(obj.ssn.reason).toBe('limited')
        expect(obj.secret.status).toBe('hidden')
        expect(obj.secret.getValue()).toBeNull()
      })
    })

    describe('nested objects', () => {
      it('should recursively deserialize nested wire format', () => {
        const wire = {
          profile: {
            name: 'John',
            contact: {
              email: { status: 'full' as const, value: 'john@example.com' }
            }
          }
        }

        const obj = deserializeFromWire(wire)

        expect(obj.profile.name).toBe('John')
        expect(obj.profile.contact.email).toBeInstanceOf(SensitiveField)
        expect(obj.profile.contact.email.getValue()).toBe('john@example.com')
      })
    })

    describe('arrays', () => {
      it('should deserialize arrays of wire format', () => {
        const wire = {
          emails: [
            { status: 'full' as const, value: 'a@example.com' },
            { status: 'masked' as const, value: 'b***@example.com' }
          ]
        }

        const obj = deserializeFromWire(wire)

        expect(obj.emails).toHaveLength(2)
        expect(obj.emails[0]).toBeInstanceOf(SensitiveField)
        expect(obj.emails[0].status).toBe('full')
        expect(obj.emails[1].status).toBe('masked')
      })

      it('should deserialize arrays of objects with wire format fields', () => {
        const wire = {
          contacts: [
            { name: 'John', email: { status: 'full' as const, value: 'john@example.com' } },
            { name: 'Jane', email: { status: 'hidden' as const, value: null } }
          ]
        }

        const obj = deserializeFromWire(wire)

        expect(obj.contacts[0].name).toBe('John')
        expect(obj.contacts[0].email).toBeInstanceOf(SensitiveField)
        expect(obj.contacts[1].email.isHidden()).toBe(true)
      })
    })

    describe('round-trip', () => {
      it('should round-trip correctly', () => {
        const original = {
          name: 'John',
          profile: {
            email: SensitiveField.full('john@example.com', 'email'),
            phone: SensitiveField.masked('***-***-1234', 'phone', 'limited')
          },
          scores: [1, 2, 3]
        }

        const wire = serializeToWire(original)
        const restored = deserializeFromWire(wire)

        expect(restored.name).toBe('John')
        expect(restored.profile.email.status).toBe('full')
        expect(restored.profile.email.getValue()).toBe('john@example.com')
        expect(restored.profile.phone.status).toBe('masked')
        expect(restored.profile.phone.reason).toBe('limited')
        expect(restored.scores).toEqual([1, 2, 3])
      })
    })
  })
})
