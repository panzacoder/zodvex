/**
 * Fail-secure defaults for non-secure wrappers.
 *
 * This module provides safe defaults for when sensitive fields are encountered
 * in contexts without proper FLS configuration:
 *
 * - `autoLimit()` - Convert all sensitive fields to hidden (for queries)
 * - `assertNoSensitive()` - Throw if schema contains sensitive fields (for mutations)
 */

import type { z } from 'zod'
import { transformBySchema } from '../transform'
import { findSensitiveFields, getSensitiveMetadata } from './sensitive'
import type { ReasonCode, SensitiveDb, SensitiveWire } from './types'

/**
 * Options for autoLimit.
 */
export interface AutoLimitOptions {
  /** Default reason to include in hidden fields */
  defaultReason?: ReasonCode
}

/**
 * Check if a value looks like a SensitiveDb wrapper.
 */
function isSensitiveDbValue(value: unknown): value is SensitiveDb<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__sensitiveValue' in value &&
    !('status' in value)
  )
}

/**
 * Auto-limit all sensitive fields to hidden status.
 *
 * This is the fail-secure default for standard zQuery - any sensitive field
 * that wasn't properly handled by FLS is automatically hidden.
 *
 * Uses the transform layer with a `shouldTransform` predicate to only process
 * schemas marked as sensitive, avoiding callback overhead for non-sensitive fields.
 *
 * @param value - The value to transform
 * @param schema - The Zod schema describing the value
 * @param options - Options including default reason
 * @returns The value with all sensitive fields set to hidden
 */
export function autoLimit<T>(value: T, schema: z.ZodTypeAny, options?: AutoLimitOptions): T {
  const defaultReason = options?.defaultReason

  return transformBySchema(
    value,
    schema,
    null, // No context needed
    val => {
      // Only called for sensitive schemas (due to shouldTransform predicate)
      if (isSensitiveDbValue(val)) {
        const wire: SensitiveWire = {
          status: 'hidden',
          value: null
        }
        if (defaultReason) {
          wire.reason = defaultReason
        }
        return wire
      }
      return val
    },
    {
      // Only call transform callback for sensitive schemas
      shouldTransform: sch => getSensitiveMetadata(sch) !== undefined
    }
  )
}

/**
 * Options for assertNoSensitive.
 */
export interface AssertNoSensitiveOptions {
  /** Custom error message */
  message?: string
}

/**
 * Assert that a schema does not contain any sensitive fields.
 *
 * This is the fail-secure default for standard zMutation/zAction -
 * if a mutation schema contains sensitive fields, it should use
 * zSecureMutation instead.
 *
 * @param schema - The Zod schema to check
 * @param options - Options including custom error message
 * @throws Error if schema contains sensitive fields
 */
export function assertNoSensitive(schema: z.ZodTypeAny, options?: AssertNoSensitiveOptions): void {
  const sensitiveFields = findSensitiveFields(schema)

  if (sensitiveFields.length > 0) {
    const paths = sensitiveFields.map(f => f.path).join(', ')
    const message =
      options?.message ?? `Schema contains sensitive fields that require FLS: ${paths}`
    throw new Error(message)
  }
}
