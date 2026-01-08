/**
 * Wire format serialization/deserialization helpers.
 *
 * This module provides functions to convert between:
 * - Objects containing SensitiveField instances (server runtime)
 * - Objects containing wire format (JSON-serializable, for transport)
 *
 * These are useful when you need to:
 * - Serialize a complex object with multiple SensitiveFields for API response
 * - Deserialize an API response back to SensitiveField instances on the client
 */

import { SensitiveField } from './sensitive-field'
import type { SensitiveStatus, SensitiveWire } from './types'

/**
 * Check if a value is in wire format (has status and value properties).
 */
export function isSensitiveWire(value: unknown): value is SensitiveWire {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'value' in value &&
    typeof (value as Record<string, unknown>).status === 'string'
  )
}

/**
 * Check if a value is a SensitiveField instance.
 */
function isSensitiveField(value: unknown): value is SensitiveField<unknown> {
  return value instanceof SensitiveField
}

/**
 * Recursively serialize an object, converting SensitiveField instances to wire format.
 *
 * @example
 * ```ts
 * const obj = {
 *   name: 'John',
 *   email: SensitiveField.full('john@example.com', 'email')
 * }
 *
 * const wire = serializeToWire(obj)
 * // { name: 'John', email: { status: 'full', value: 'john@example.com', __sensitiveField: 'email' } }
 * ```
 */
export function serializeToWire<T>(value: T): T {
  return transform(value, v => {
    if (isSensitiveField(v)) {
      return v.toWire()
    }
    return v
  }) as T
}

/**
 * Recursively deserialize an object, converting wire format to SensitiveField instances.
 *
 * @example
 * ```ts
 * const wire = {
 *   name: 'John',
 *   email: { status: 'full', value: 'john@example.com' }
 * }
 *
 * const obj = deserializeFromWire(wire)
 * // { name: 'John', email: SensitiveField<string> }
 * ```
 */
export function deserializeFromWire<T>(value: T): T {
  return transform(value, v => {
    if (isSensitiveWire(v)) {
      return SensitiveField.fromWire(v)
    }
    return v
  }) as T
}

/**
 * Generic recursive transform helper.
 */
function transform(value: unknown, fn: (v: unknown) => unknown): unknown {
  // Check for transformation first (before recursion)
  const transformed = fn(value)
  if (transformed !== value) {
    return transformed
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(item => transform(item, fn))
  }

  // Handle plain objects (not class instances like SensitiveField, Date, etc.)
  if (typeof value === 'object' && value.constructor === Object) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = transform(val, fn)
    }
    return result
  }

  // Return primitives and other objects unchanged
  return value
}
