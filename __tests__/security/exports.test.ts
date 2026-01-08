/**
 * Tests for security module public API surface.
 *
 * Ensures all expected exports are available and prevents accidental breaking changes.
 */

import { describe, expect, it } from 'bun:test'
import * as security from '../../src/security'

describe('security module exports', () => {
  it('should export all expected functions', () => {
    const expectedFunctions = [
      // Sensitive marker
      'sensitive',
      'isSensitiveSchema',
      'getSensitiveMetadata',
      'findSensitiveFields',
      // Policy resolution
      'resolveReadPolicy',
      'resolveWritePolicy',
      // Apply policy
      'applyReadPolicy',
      'validateWritePolicy',
      'assertWriteAllowed',
      // SensitiveField class
      'SensitiveField',
      // Wire helpers
      'serializeToWire',
      'deserializeFromWire',
      'isSensitiveWire',
      // Fail-secure
      'autoLimit',
      'assertNoSensitive',
      // RLS
      'checkRlsRead',
      'checkRlsWrite',
      'filterByRls',
      // Secure DB
      'createSecureReader',
      'createSecureWriter',
      // Secure wrappers
      'zSecureQuery',
      'zSecureMutation',
      'zSecureAction'
    ]

    for (const fn of expectedFunctions) {
      expect(security).toHaveProperty(fn)
      expect(typeof (security as any)[fn]).toBe('function')
    }
  })

  it('should export all expected constants', () => {
    expect(security.SENSITIVE_META_KEY).toBe('zodvex:sensitive')
  })

  it('should export RLS functions with correct types', () => {
    expect(typeof security.checkRlsRead).toBe('function')
    expect(typeof security.checkRlsWrite).toBe('function')
    expect(typeof security.filterByRls).toBe('function')
  })

  it('should export secure DB functions with correct types', () => {
    expect(typeof security.createSecureReader).toBe('function')
    expect(typeof security.createSecureWriter).toBe('function')
  })

  it('should export secure wrapper functions with correct types', () => {
    expect(typeof security.zSecureQuery).toBe('function')
    expect(typeof security.zSecureMutation).toBe('function')
    expect(typeof security.zSecureAction).toBe('function')
  })
})
