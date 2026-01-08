/**
 * Tests for src/security/client.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests framework-agnostic client utilities for working with
 * sensitive field data received from the server.
 */

import { describe, expect, it } from 'bun:test'
import {
  deserializeResponse,
  isSensitiveFieldData,
  getFieldValue,
  isFieldHidden,
  isFieldMasked,
  isFieldFull
} from '../../src/security/client'

describe('security/client.ts', () => {
  describe('isSensitiveFieldData()', () => {
    it('should return true for wire format objects', () => {
      expect(isSensitiveFieldData({ status: 'full', value: 'test' })).toBe(true)
      expect(isSensitiveFieldData({ status: 'masked', value: '***' })).toBe(true)
      expect(isSensitiveFieldData({ status: 'hidden', value: null })).toBe(true)
    })

    it('should return false for non-wire objects', () => {
      expect(isSensitiveFieldData({ value: 'test' })).toBe(false)
      expect(isSensitiveFieldData({ status: 'full' })).toBe(false)
      expect(isSensitiveFieldData(null)).toBe(false)
      expect(isSensitiveFieldData('string')).toBe(false)
    })
  })

  describe('getFieldValue()', () => {
    it('should return value for full status', () => {
      const data = { status: 'full' as const, value: 'secret@example.com' }
      expect(getFieldValue(data)).toBe('secret@example.com')
    })

    it('should return value for masked status', () => {
      const data = { status: 'masked' as const, value: 's***@example.com' }
      expect(getFieldValue(data)).toBe('s***@example.com')
    })

    it('should return null for hidden status', () => {
      const data = { status: 'hidden' as const, value: null }
      expect(getFieldValue(data)).toBeNull()
    })

    it('should return default value for hidden status when provided', () => {
      const data = { status: 'hidden' as const, value: null }
      expect(getFieldValue(data, 'N/A')).toBe('N/A')
    })
  })

  describe('status checkers', () => {
    it('isFieldFull() should correctly identify full status', () => {
      expect(isFieldFull({ status: 'full', value: 'test' })).toBe(true)
      expect(isFieldFull({ status: 'masked', value: '***' })).toBe(false)
      expect(isFieldFull({ status: 'hidden', value: null })).toBe(false)
    })

    it('isFieldMasked() should correctly identify masked status', () => {
      expect(isFieldMasked({ status: 'full', value: 'test' })).toBe(false)
      expect(isFieldMasked({ status: 'masked', value: '***' })).toBe(true)
      expect(isFieldMasked({ status: 'hidden', value: null })).toBe(false)
    })

    it('isFieldHidden() should correctly identify hidden status', () => {
      expect(isFieldHidden({ status: 'full', value: 'test' })).toBe(false)
      expect(isFieldHidden({ status: 'masked', value: '***' })).toBe(false)
      expect(isFieldHidden({ status: 'hidden', value: null })).toBe(true)
    })
  })

  describe('deserializeResponse()', () => {
    it('should pass through non-sensitive data unchanged', () => {
      const response = {
        name: 'John',
        age: 30,
        tags: ['a', 'b']
      }

      const result = deserializeResponse(response)

      expect(result).toEqual(response)
    })

    it('should preserve sensitive field wire format', () => {
      const response = {
        name: 'John',
        email: { status: 'full' as const, value: 'john@example.com' }
      }

      const result = deserializeResponse(response)

      // Wire format is preserved - client can use type helpers
      expect(result.email.status).toBe('full')
      expect(result.email.value).toBe('john@example.com')
    })

    it('should handle nested objects', () => {
      const response = {
        profile: {
          name: 'John',
          contact: {
            email: { status: 'masked' as const, value: 'j***@example.com', reason: 'limited' }
          }
        }
      }

      const result = deserializeResponse(response)

      expect(result.profile.contact.email.status).toBe('masked')
      expect(result.profile.contact.email.reason).toBe('limited')
    })

    it('should handle arrays', () => {
      const response = {
        contacts: [
          { name: 'John', email: { status: 'full' as const, value: 'john@example.com' } },
          { name: 'Jane', email: { status: 'hidden' as const, value: null } }
        ]
      }

      const result = deserializeResponse(response)

      expect(result.contacts[0].email.status).toBe('full')
      expect(result.contacts[1].email.status).toBe('hidden')
    })
  })

  describe('usage patterns', () => {
    it('should support conditional rendering based on status', () => {
      type User = {
        name: string
        email: { status: 'full' | 'masked' | 'hidden'; value: string | null }
      }

      const user: User = {
        name: 'John',
        email: { status: 'masked', value: 'j***@example.com' }
      }

      // Pattern: check status before rendering
      let displayValue: string
      if (isFieldFull(user.email)) {
        displayValue = `Email: ${user.email.value}`
      } else if (isFieldMasked(user.email)) {
        displayValue = `Email: ${user.email.value} (partial)`
      } else {
        displayValue = 'Email: [hidden]'
      }

      expect(displayValue).toBe('Email: j***@example.com (partial)')
    })

    it('should support using getFieldValue with fallback', () => {
      const hiddenEmail = { status: 'hidden' as const, value: null }
      const maskedEmail = { status: 'masked' as const, value: 'j***@example.com' }

      expect(getFieldValue(hiddenEmail, 'Not available')).toBe('Not available')
      expect(getFieldValue(maskedEmail, 'Not available')).toBe('j***@example.com')
    })
  })
})
