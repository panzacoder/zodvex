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
  const meta = schema.meta?.() as Record<string, unknown> | undefined
  const sensitiveMeta = meta?.[SENSITIVE_META_KEY] as SensitiveMetadata | undefined
  return sensitiveMeta?.sensitive === true
}

/**
 * Get the sensitive metadata from a schema, if present.
 */
export function getSensitiveMetadata<TReq = unknown>(
  schema: z.ZodTypeAny
): SensitiveMetadata<TReq> | undefined {
  const meta = schema.meta?.() as Record<string, unknown> | undefined
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
 * Recursively find all sensitive fields in a Zod schema.
 *
 * @param schema - The Zod schema to traverse
 * @param basePath - Optional prefix for all paths (e.g., 'user' -> 'user.email')
 * @returns Array of sensitive field info with paths and metadata
 */
export function findSensitiveFields(schema: z.ZodTypeAny, basePath = ''): SensitiveFieldInfo[] {
  const results: SensitiveFieldInfo[] = []
  const visited = new Set<z.ZodTypeAny>()

  function traverse(schema: z.ZodTypeAny, currentPath: string): void {
    // Prevent infinite recursion
    if (visited.has(schema)) return
    visited.add(schema)

    const defType = (schema as any)._def?.type

    // Check if this schema itself is sensitive
    const sensitiveMeta = getSensitiveMetadata(schema)
    if (sensitiveMeta) {
      results.push({
        path: currentPath || basePath,
        meta: sensitiveMeta
      })
      // Don't recurse into sensitive fields - they're leaf nodes for our purposes
      return
    }

    // Handle optional - unwrap and recurse
    if (defType === 'optional') {
      const inner = (schema as any).unwrap()
      traverse(inner, currentPath)
      return
    }

    // Handle nullable - unwrap and recurse
    if (defType === 'nullable') {
      const inner = (schema as any).unwrap()
      traverse(inner, currentPath)
      return
    }

    // Handle objects - recurse into shape
    if (defType === 'object') {
      const shape = (schema as any).shape
      if (shape) {
        for (const [key, fieldSchema] of Object.entries(shape)) {
          const fieldPath = currentPath ? `${currentPath}.${key}` : key
          traverse(fieldSchema as z.ZodTypeAny, fieldPath)
        }
      }
      return
    }

    // Handle arrays - recurse into element with [] notation
    if (defType === 'array') {
      const element = (schema as any).element
      if (element) {
        const arrayPath = currentPath ? `${currentPath}[]` : '[]'
        traverse(element, arrayPath)
      }
      return
    }

    // Handle unions - recurse into all options
    if (defType === 'union') {
      const options = (schema as any)._def.options as z.ZodTypeAny[] | undefined
      if (options) {
        for (const option of options) {
          traverse(option, currentPath)
        }
      }
      return
    }

    // Handle discriminated unions - recurse into all options
    // Note: In Zod v4, discriminatedUnion uses 'union' defType with a discriminator property
    // We handle it the same as regular unions for findSensitiveFields purposes
    const discriminator = (schema as any)._def?.discriminator
    if (discriminator) {
      const options =
        (schema as any)._def.options ||
        ((schema as any)._def.optionsMap
          ? Array.from((schema as any)._def.optionsMap.values())
          : [])
      if (options) {
        for (const option of options) {
          traverse(option as z.ZodTypeAny, currentPath)
        }
      }
      return
    }

    // For other types (string, number, etc.), nothing to do if not sensitive
  }

  traverse(schema, basePath)
  return results
}
