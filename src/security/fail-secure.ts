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
import { findSensitiveFields, getSensitiveMetadata } from './sensitive'
import { SensitiveField } from './sensitive-field'
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
 * @param value - The value to transform
 * @param schema - The Zod schema describing the value
 * @param options - Options including default reason
 * @returns The value with all sensitive fields set to hidden
 */
export function autoLimit<T>(value: T, schema: z.ZodTypeAny, options?: AutoLimitOptions): T {
  return transformValue(value, schema, '', options?.defaultReason) as T
}

/**
 * Recursive transform that converts SensitiveDb values to hidden SensitiveWire.
 */
function transformValue(
  value: unknown,
  schema: z.ZodTypeAny,
  path: string,
  defaultReason?: ReasonCode
): unknown {
  if (value === undefined || value === null) {
    return value
  }

  const defType = (schema as any)._def?.type

  // Check if this schema is sensitive and value is SensitiveDb
  const meta = getSensitiveMetadata(schema)
  if (meta && isSensitiveDbValue(value)) {
    // Auto-limit to hidden
    const wire: SensitiveWire = {
      status: 'hidden',
      value: null
    }
    if (defaultReason) {
      wire.reason = defaultReason
    }
    return wire
  }

  // Handle optional - unwrap and recurse
  if (defType === 'optional') {
    const inner = (schema as any).unwrap()
    return transformValue(value, inner, path, defaultReason)
  }

  // Handle nullable - unwrap and recurse
  if (defType === 'nullable') {
    if (value === null) return null
    const inner = (schema as any).unwrap()
    return transformValue(value, inner, path, defaultReason)
  }

  // Handle objects - recurse into shape
  if (defType === 'object' && typeof value === 'object' && value !== null) {
    const shape = (schema as any).shape
    if (shape) {
      const result: Record<string, unknown> = {}
      for (const [key, fieldSchema] of Object.entries(shape)) {
        const fieldPath = path ? `${path}.${key}` : key
        const fieldValue = (value as Record<string, unknown>)[key]
        result[key] = transformValue(
          fieldValue,
          fieldSchema as z.ZodTypeAny,
          fieldPath,
          defaultReason
        )
      }
      return result
    }
  }

  // Handle arrays
  if (defType === 'array' && Array.isArray(value)) {
    const element = (schema as any).element
    return value.map((item, i) => transformValue(item, element, `${path}[${i}]`, defaultReason))
  }

  // Handle unions - try to find matching variant
  if (defType === 'union') {
    const unionOptions = (schema as any)._def.options as z.ZodTypeAny[] | undefined
    const discriminator = (schema as any)._def?.discriminator

    if (discriminator && typeof value === 'object' && value !== null && unionOptions) {
      const discValue = (value as Record<string, unknown>)[discriminator]

      for (const variant of unionOptions) {
        const variantShape = (variant as any).shape
        if (variantShape) {
          const discField = variantShape[discriminator]
          const discDefType = (discField as any)?._def?.type

          if (discDefType === 'literal') {
            const literalValues = (discField as any)._def.values as unknown[]
            if (literalValues?.includes(discValue)) {
              return transformValue(value, variant, path, defaultReason)
            }
          }
        }
      }
    }

    // For regular unions, try each variant
    if (unionOptions) {
      for (const variant of unionOptions) {
        try {
          return transformValue(value, variant, path, defaultReason)
        } catch {
          // Try next variant
        }
      }
    }
  }

  // Return primitives and other values unchanged
  return value
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
