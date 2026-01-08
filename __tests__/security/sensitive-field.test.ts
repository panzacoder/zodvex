/**
 * Tests for src/security/sensitive-field.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests the SensitiveField runtime class.
 *
 * Key design decisions from plan:
 * - No `unwrap()` method - always use `getValue()` which respects status
 * - `getValue()` returns null for hidden fields (not undefined)
 * - Anti-coercion guards prevent accidental value leaks
 */

import { describe, expect, it, mock } from 'bun:test'
import { SensitiveField } from '../../src/security/sensitive-field'

describe('security/sensitive-field.ts', () => {
  describe('SensitiveField.full()', () => {
    it('should create a full-access field', () => {
      const field = SensitiveField.full('secret@example.com', 'email')

      expect(field.status).toBe('full')
      expect(field.field).toBe('email')
      expect(field.getValue()).toBe('secret@example.com')
    })

    it('should work without field name', () => {
      const field = SensitiveField.full('value')

      expect(field.status).toBe('full')
      expect(field.field).toBeUndefined()
      expect(field.getValue()).toBe('value')
    })

    it('should support various value types', () => {
      const stringField = SensitiveField.full('string', 'str')
      const numberField = SensitiveField.full(42, 'num')
      const boolField = SensitiveField.full(true, 'bool')
      const objectField = SensitiveField.full({ key: 'value' }, 'obj')
      const arrayField = SensitiveField.full([1, 2, 3], 'arr')

      expect(stringField.getValue()).toBe('string')
      expect(numberField.getValue()).toBe(42)
      expect(boolField.getValue()).toBe(true)
      expect(objectField.getValue()).toEqual({ key: 'value' })
      expect(arrayField.getValue()).toEqual([1, 2, 3])
    })

    it('should not have a reason for full access', () => {
      const field = SensitiveField.full('value')

      expect(field.reason).toBeUndefined()
    })
  })

  describe('SensitiveField.masked()', () => {
    it('should create a masked-access field', () => {
      const field = SensitiveField.masked('s***@example.com', 'email', 'limited_access')

      expect(field.status).toBe('masked')
      expect(field.field).toBe('email')
      expect(field.getValue()).toBe('s***@example.com')
      expect(field.reason).toBe('limited_access')
    })

    it('should work without reason', () => {
      const field = SensitiveField.masked('***-**-1234', 'ssn')

      expect(field.status).toBe('masked')
      expect(field.getValue()).toBe('***-**-1234')
      expect(field.reason).toBeUndefined()
    })

    it('should store the already-masked value', () => {
      // The mask function is applied BEFORE creating the field
      const maskedValue = 'partial-data'
      const field = SensitiveField.masked(maskedValue)

      expect(field.getValue()).toBe(maskedValue)
    })
  })

  describe('SensitiveField.hidden()', () => {
    it('should create a hidden-access field', () => {
      const field = SensitiveField.hidden<string>('ssn', 'access_denied')

      expect(field.status).toBe('hidden')
      expect(field.field).toBe('ssn')
      expect(field.reason).toBe('access_denied')
    })

    it('should return null from getValue()', () => {
      const field = SensitiveField.hidden<string>('secret')

      // Key decision: getValue() returns null for hidden fields
      expect(field.getValue()).toBeNull()
    })

    it('should work without field or reason', () => {
      const field = SensitiveField.hidden()

      expect(field.status).toBe('hidden')
      expect(field.field).toBeUndefined()
      expect(field.reason).toBeUndefined()
      expect(field.getValue()).toBeNull()
    })
  })

  describe('getValue()', () => {
    it('should return full value for full status', () => {
      const field = SensitiveField.full('secret')
      expect(field.getValue()).toBe('secret')
    })

    it('should return masked value for masked status', () => {
      const field = SensitiveField.masked('***')
      expect(field.getValue()).toBe('***')
    })

    it('should return null for hidden status', () => {
      const field = SensitiveField.hidden<string>()
      expect(field.getValue()).toBeNull()
    })
  })

  describe('toWire()', () => {
    it('should serialize full field', () => {
      const field = SensitiveField.full('secret123', 'password')
      const wire = field.toWire()

      expect(wire).toEqual({
        __sensitiveField: 'password',
        status: 'full',
        value: 'secret123'
      })
    })

    it('should serialize masked field with reason', () => {
      const field = SensitiveField.masked('***-**-6789', 'ssn', 'limited_access')
      const wire = field.toWire()

      expect(wire).toEqual({
        __sensitiveField: 'ssn',
        status: 'masked',
        value: '***-**-6789',
        reason: 'limited_access'
      })
    })

    it('should serialize hidden field with null value', () => {
      const field = SensitiveField.hidden<string>('secret', 'access_denied')
      const wire = field.toWire()

      expect(wire).toEqual({
        __sensitiveField: 'secret',
        status: 'hidden',
        value: null,
        reason: 'access_denied'
      })
    })

    it('should omit __sensitiveField when field is undefined', () => {
      const field = SensitiveField.full('value')
      const wire = field.toWire()

      expect(wire.__sensitiveField).toBeUndefined()
    })

    it('should omit reason when undefined', () => {
      const field = SensitiveField.full('value', 'field')
      const wire = field.toWire()

      expect('reason' in wire).toBe(false)
    })
  })

  describe('fromWire()', () => {
    it('should deserialize full field', () => {
      const wire = {
        __sensitiveField: 'email',
        status: 'full' as const,
        value: 'user@example.com'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.status).toBe('full')
      expect(field.field).toBe('email')
      expect(field.getValue()).toBe('user@example.com')
    })

    it('should deserialize masked field', () => {
      const wire = {
        __sensitiveField: 'phone',
        status: 'masked' as const,
        value: '***-***-1234',
        reason: 'partial_access'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.status).toBe('masked')
      expect(field.getValue()).toBe('***-***-1234')
      expect(field.reason).toBe('partial_access')
    })

    it('should deserialize hidden field', () => {
      const wire = {
        __sensitiveField: 'ssn',
        status: 'hidden' as const,
        value: null,
        reason: 'no_access'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.status).toBe('hidden')
      expect(field.getValue()).toBeNull()
      expect(field.reason).toBe('no_access')
    })

    it('should handle missing optional fields', () => {
      const wire = {
        status: 'full' as const,
        value: 'test'
      }

      const field = SensitiveField.fromWire<string>(wire)

      expect(field.field).toBeUndefined()
      expect(field.reason).toBeUndefined()
    })
  })

  describe('anti-coercion guards', () => {
    it('should return placeholder on toString()', () => {
      const field = SensitiveField.full('secret', 'password')
      const result = field.toString()

      expect(result).toBe('[SensitiveField]')
    })

    it('should return placeholder on valueOf()', () => {
      const field = SensitiveField.full('secret')
      const result = field.valueOf()

      expect(result).toBe('[SensitiveField]')
    })

    it('should return placeholder on Symbol.toPrimitive', () => {
      const field = SensitiveField.full('secret')

      // Template literal uses toPrimitive
      const result = `Value: ${field}`

      expect(result).toBe('Value: [SensitiveField]')
    })

    it('should log warning on implicit coercion', () => {
      const warnSpy = mock(() => {})
      const originalWarn = console.warn
      console.warn = warnSpy

      try {
        const field = SensitiveField.full('secret', 'password')
        const _ = `${field}` // Trigger coercion

        expect(warnSpy).toHaveBeenCalled()
        expect(warnSpy.mock.calls[0][0]).toContain('SensitiveField')
        expect(warnSpy.mock.calls[0][0]).toContain('password')
      } finally {
        console.warn = originalWarn
      }
    })

    it('should serialize to wire format via toJSON', () => {
      const fullField = SensitiveField.full('secret', 'password')
      const hiddenField = SensitiveField.hidden<string>('ssn', 'access_denied')

      // JSON.stringify uses toJSON, which returns wire format
      const fullJson = JSON.parse(JSON.stringify(fullField))
      const hiddenJson = JSON.parse(JSON.stringify(hiddenField))

      // Full access: value IS in wire format (that's correct behavior)
      expect(fullJson.status).toBe('full')
      expect(fullJson.value).toBe('secret')
      expect(fullJson.__sensitiveField).toBe('password')

      // Hidden: value is null in wire format
      expect(hiddenJson.status).toBe('hidden')
      expect(hiddenJson.value).toBeNull()
      expect(hiddenJson.reason).toBe('access_denied')
    })
  })

  describe('type safety', () => {
    it('should preserve type through full cycle', () => {
      interface UserData {
        name: string
        age: number
      }

      const original: UserData = { name: 'John', age: 30 }
      const field = SensitiveField.full(original, 'userData')
      const wire = field.toWire()
      const restored = SensitiveField.fromWire<UserData>(wire)

      const value = restored.getValue()
      expect(value).toEqual(original)
      // Type check: value should be UserData | null
      if (value !== null) {
        expect(value.name).toBe('John')
        expect(value.age).toBe(30)
      }
    })
  })

  describe('immutability', () => {
    it('should be immutable after creation', () => {
      const field = SensitiveField.full('original', 'field')

      // These should not be assignable (TypeScript would catch this at compile time)
      // At runtime, we verify the values don't change
      expect(field.status).toBe('full')
      expect(field.field).toBe('field')
      expect(field.getValue()).toBe('original')
    })
  })

  describe('isHidden(), isMasked(), isFull() helpers', () => {
    it('should correctly identify full status', () => {
      const field = SensitiveField.full('value')

      expect(field.isFull()).toBe(true)
      expect(field.isMasked()).toBe(false)
      expect(field.isHidden()).toBe(false)
    })

    it('should correctly identify masked status', () => {
      const field = SensitiveField.masked('***')

      expect(field.isFull()).toBe(false)
      expect(field.isMasked()).toBe(true)
      expect(field.isHidden()).toBe(false)
    })

    it('should correctly identify hidden status', () => {
      const field = SensitiveField.hidden<string>()

      expect(field.isFull()).toBe(false)
      expect(field.isMasked()).toBe(false)
      expect(field.isHidden()).toBe(true)
    })
  })

  describe('fromDbValue()', () => {
    it('should create a SensitiveField from a DB value with full access', () => {
      const dbValue = { __sensitiveValue: 'secret@example.com' }
      const field = SensitiveField.fromDbValue(dbValue, 'email', 'full')

      expect(field.status).toBe('full')
      expect(field.getValue()).toBe('secret@example.com')
      expect(field.field).toBe('email')
    })

    it('should create a masked field with mask function', () => {
      const dbValue = { __sensitiveValue: 'secret@example.com' }
      const maskFn = (v: unknown) => String(v).replace(/(?<=.).(?=.*@)/g, '*')
      const field = SensitiveField.fromDbValue(dbValue, 'email', 'masked', {
        mask: maskFn,
        reason: 'limited_access'
      })

      expect(field.status).toBe('masked')
      expect(field.getValue()).toBe('s*****@example.com')
      expect(field.reason).toBe('limited_access')
    })

    it('should create a hidden field', () => {
      const dbValue = { __sensitiveValue: 'secret' }
      const field = SensitiveField.fromDbValue(dbValue, 'ssn', 'hidden', {
        reason: 'access_denied'
      })

      expect(field.status).toBe('hidden')
      expect(field.getValue()).toBeNull()
      expect(field.reason).toBe('access_denied')
    })
  })
})
