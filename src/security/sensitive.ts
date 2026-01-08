/**
 * Sensitive field marker and metadata utilities.
 *
 * This module provides:
 * - sensitive() - Mark a Zod schema as containing sensitive data
 * - isSensitiveSchema() - Check if a schema is marked sensitive
 * - getSensitiveMetadata() - Get the full metadata from a sensitive schema
 * - findSensitiveFields() - Recursively find all sensitive fields in a schema
 */

import type { z } from 'zod'
import { findFieldsWithMeta, getMetadata, hasMetadata } from '../transform'
import type { ReadPolicy, SensitiveMetadata, WritePolicy } from './types'

/**
 * Metadata key used to store sensitive field information in Zod's .meta()
 */
export const SENSITIVE_META_KEY = 'zodvex:sensitive'

/**
 * Options for the sensitive() marker.
 */
export interface SensitiveOptions<TReq = unknown> {
  /** Read access policy (ordered array of tiers) */
  read?: ReadPolicy<TReq>
  /** Write access policy */
  write?: WritePolicy<TReq>
}

/**
 * Mark a Zod schema as sensitive.
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   email: sensitive(z.string(), {
 *     read: [
 *       { status: 'full', requirements: 'admin' },
 *       { status: 'masked', requirements: 'user', mask: v => maskEmail(v) }
 *     ],
 *     write: { requirements: 'admin' }
 *   })
 * })
 * ```
 */
export function sensitive<T extends z.ZodTypeAny, TReq = unknown>(
  inner: T,
  options?: SensitiveOptions<TReq>
): T {
  const meta: SensitiveMetadata<TReq> = {
    sensitive: true,
    read: options?.read,
    write: options?.write
  }

  return inner.meta({ [SENSITIVE_META_KEY]: meta }) as T
}

/**
 * Check if a Zod schema is marked as sensitive.
 */
export function isSensitiveSchema(schema: z.ZodTypeAny): boolean {
  return hasMetadata(schema, meta => {
    const sensitiveMeta = meta[SENSITIVE_META_KEY] as SensitiveMetadata | undefined
    return sensitiveMeta?.sensitive === true
  })
}

/**
 * Get the sensitive metadata from a schema, if present.
 */
export function getSensitiveMetadata<TReq = unknown>(
  schema: z.ZodTypeAny
): SensitiveMetadata<TReq> | undefined {
  const meta = getMetadata(schema)
  const sensitiveMeta = meta?.[SENSITIVE_META_KEY] as SensitiveMetadata<TReq> | undefined
  if (sensitiveMeta?.sensitive === true) {
    return sensitiveMeta
  }
  return undefined
}

/**
 * Result from findSensitiveFields().
 */
export interface SensitiveFieldInfo {
  /** Dot-notation path to the field (e.g., 'profile.email', 'contacts[].email') */
  path: string
  /** The sensitive metadata for this field */
  meta: SensitiveMetadata
}

/**
 * Type guard to check if metadata contains sensitive field marker.
 */
function hasSensitiveMarker(
  meta: Record<string, unknown> | undefined
): meta is Record<string, unknown> & { [K in typeof SENSITIVE_META_KEY]: SensitiveMetadata } {
  const sensitiveMeta = meta?.[SENSITIVE_META_KEY] as SensitiveMetadata | undefined
  return sensitiveMeta?.sensitive === true
}

/**
 * Recursively find all sensitive fields in a Zod schema.
 *
 * Uses the transform layer's findFieldsWithMeta under the hood.
 *
 * @param schema - The Zod schema to traverse
 * @param basePath - Optional prefix for all paths (e.g., 'user' -> 'user.email')
 * @returns Array of sensitive field info with paths and metadata
 */
export function findSensitiveFields(schema: z.ZodTypeAny, basePath = ''): SensitiveFieldInfo[] {
  const fields = findFieldsWithMeta(schema, hasSensitiveMarker)

  return fields.map(field => ({
    path: basePath ? (field.path ? `${basePath}.${field.path}` : basePath) : field.path,
    meta: field.meta[SENSITIVE_META_KEY]
  }))
}
