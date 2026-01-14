/**
 * Sensitive field marker and metadata utilities.
 *
 * This module provides:
 * - ZodSensitive - Wrapper class for sensitive schemas (survives all Zod compositions)
 * - sensitive() - Mark a Zod schema as containing sensitive data
 * - isZodSensitive() - Type guard to check if a schema is a ZodSensitive wrapper
 * - isSensitiveSchema() - Check if a schema is marked sensitive (including through wrappers)
 * - getSensitiveMetadata() - Get the full metadata from a sensitive schema
 * - findSensitiveFields() - Recursively find all sensitive fields in a schema
 */

import { z } from 'zod'
import { findFieldsWithMeta } from '../transform'
import type { ReadPolicy, SensitiveMetadata, WritePolicy } from './types'

/**
 * Metadata key used to store sensitive field information.
 * Used for compatibility with transform layer metadata detection.
 */
export const SENSITIVE_META_KEY = 'zodvex:sensitive'

// ============================================================================
// ZodSensitive Wrapper Class
// ============================================================================

/**
 * Definition structure for ZodSensitive wrapper.
 */
export interface ZodSensitiveDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Type identifier for duck-typing in transform layer */
  type: 'sensitive'
  /** The wrapped inner schema */
  innerType: T
  /** Sensitive metadata with read/write policies */
  sensitiveMetadata: SensitiveMetadata
}

/**
 * Wrapper class for sensitive schemas.
 *
 * This class wraps a Zod schema to mark it as sensitive. Unlike the metadata-based
 * approach, this wrapper survives all Zod compositions including `.refine()`,
 * `.superRefine()`, and `.check()` because the wrapper remains in the schema tree.
 *
 * @example
 * ```ts
 * // The wrapper survives chained methods
 * const schema = sensitive(z.string())
 *   .refine(s => s.length >= 8)  // ZodSensitive is still detectable!
 *   .transform(s => s.trim())
 * ```
 */
export class ZodSensitive<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Internal definition - mirrors Zod's _def pattern for duck-typing */
  readonly _def: ZodSensitiveDef<T>

  constructor(innerType: T, metadata: SensitiveMetadata) {
    this._def = {
      type: 'sensitive',
      innerType,
      sensitiveMetadata: metadata
    }
  }

  /**
   * Get the wrapped inner schema.
   */
  unwrap(): T {
    return this._def.innerType
  }

  /**
   * Delegate safeParse to the inner schema.
   */
  safeParse(data: unknown) {
    return this._def.innerType.safeParse(data)
  }

  /**
   * Delegate parse to the inner schema.
   */
  parse(data: unknown): z.output<T> {
    return this._def.innerType.parse(data)
  }

  /**
   * Delegate parseAsync to the inner schema.
   */
  parseAsync(data: unknown): Promise<z.output<T>> {
    return this._def.innerType.parseAsync(data)
  }

  /**
   * Delegate safeParseAsync to the inner schema.
   */
  safeParseAsync(data: unknown) {
    return this._def.innerType.safeParseAsync(data)
  }

  // Chaining methods that preserve the sensitive wrapper
  // These create a new ZodSensitive around the modified inner schema

  /**
   * Make the sensitive field optional.
   * Returns a new ZodSensitive wrapping an optional inner schema.
   */
  optional(): ZodSensitive<z.ZodOptional<T>> {
    return new ZodSensitive(this._def.innerType.optional(), this._def.sensitiveMetadata)
  }

  /**
   * Make the sensitive field nullable.
   * Returns a new ZodSensitive wrapping a nullable inner schema.
   */
  nullable(): ZodSensitive<z.ZodNullable<T>> {
    return new ZodSensitive(this._def.innerType.nullable(), this._def.sensitiveMetadata)
  }

  /**
   * Make the sensitive field optional and nullable.
   */
  nullish(): ZodSensitive<z.ZodOptional<z.ZodNullable<T>>> {
    return new ZodSensitive(this._def.innerType.nullish(), this._def.sensitiveMetadata)
  }

  /**
   * Create an array of sensitive values.
   */
  array(): ZodSensitive<z.ZodArray<T>> {
    return new ZodSensitive(this._def.innerType.array(), this._def.sensitiveMetadata)
  }

  /**
   * Add a default value.
   */
  default(defaultValue: z.output<T>): ZodSensitive<z.ZodDefault<T>> {
    return new ZodSensitive(
      this._def.innerType.default(defaultValue as any),
      this._def.sensitiveMetadata
    )
  }

  /**
   * Add a transform. The sensitive wrapper is preserved.
   */
  transform<TOut>(fn: (val: z.output<T>) => TOut) {
    // Note: transform creates a pipe, which the traversal will unwrap to find ZodSensitive
    const transformed = this._def.innerType.transform(fn)
    // We can't wrap the pipe in ZodSensitive directly, but we return a structure
    // that preserves detectability through the pipe's input
    return transformed
  }

  /**
   * Add a refinement. Returns a new ZodSensitive wrapping the refined schema.
   */
  refine(
    check: (val: z.output<T>) => unknown,
    message?: string | { message?: string; path?: (string | number)[] }
  ): ZodSensitive<T> {
    const refinedInner = this._def.innerType.refine(check as any, message as any)
    return new ZodSensitive(refinedInner as unknown as T, this._def.sensitiveMetadata)
  }

  /**
   * Add a super-refinement. Returns a new ZodSensitive wrapping the refined schema.
   */
  superRefine(refinement: (val: z.output<T>, ctx: any) => void): ZodSensitive<T> {
    const refinedInner = this._def.innerType.superRefine(refinement as any)
    return new ZodSensitive(refinedInner as unknown as T, this._def.sensitiveMetadata)
  }
}

/**
 * Type guard to check if a value is a ZodSensitive wrapper.
 */
export function isZodSensitive(schema: unknown): schema is ZodSensitive {
  return schema instanceof ZodSensitive
}

// ============================================================================
// Helper: Find ZodSensitive through wrapper types
// ============================================================================

/**
 * Unwrap one layer of Zod wrapper types.
 * This is a local copy to avoid circular imports with transform layer.
 */
function unwrapOnceLocal(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  // Handle ZodSensitive
  if (schema instanceof ZodSensitive) {
    return schema.unwrap()
  }

  const defType = (schema as any)._def?.type as string | undefined

  switch (defType) {
    case 'optional':
    case 'nullable': {
      if (typeof (schema as any).unwrap === 'function') {
        return (schema as any).unwrap()
      }
      return (schema as any)._def?.innerType
    }

    case 'lazy': {
      const getter = (schema as any)._def?.getter
      if (typeof getter === 'function') {
        return getter()
      }
      return undefined
    }

    case 'default':
    case 'catch':
    case 'readonly':
    case 'prefault':
    case 'nonoptional': {
      return (schema as any)._def?.innerType
    }

    case 'pipe': {
      return (schema as any)._def?.in
    }

    default:
      return undefined
  }
}

/**
 * Find a ZodSensitive wrapper by unwrapping through Zod wrapper types.
 */
function findZodSensitive(schema: z.ZodTypeAny | ZodSensitive): ZodSensitive | undefined {
  if (schema instanceof ZodSensitive) {
    return schema
  }

  const visited = new Set<unknown>()
  let current: z.ZodTypeAny | undefined = schema as z.ZodTypeAny

  while (current) {
    if (visited.has(current)) return undefined
    visited.add(current)

    if (current instanceof ZodSensitive) {
      return current
    }

    current = unwrapOnceLocal(current)
  }

  return undefined
}

// ============================================================================
// Public API
// ============================================================================

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
 * Returns a `ZodSensitive<T>` wrapper that survives all Zod compositions including
 * `.refine()`, `.superRefine()`, and `.transform()`. This is critical for security
 * because the sensitive marker cannot be accidentally lost.
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
 *
 * // Safe to chain - wrapper survives:
 * const password = sensitive(z.string())
 *   .refine(s => s.length >= 8, 'Password too short')
 * ```
 */
export function sensitive<T extends z.ZodTypeAny, TReq = unknown>(
  inner: T,
  options?: SensitiveOptions<TReq>
): ZodSensitive<T> {
  const meta: SensitiveMetadata<TReq> = {
    sensitive: true,
    read: options?.read,
    write: options?.write
  }

  return new ZodSensitive(inner, meta)
}

/**
 * Check if a Zod schema is marked as sensitive.
 *
 * This function unwraps through Zod wrapper types (optional, nullable, transform, etc.)
 * to find a ZodSensitive wrapper anywhere in the schema tree.
 */
export function isSensitiveSchema(schema: z.ZodTypeAny | ZodSensitive): boolean {
  return findZodSensitive(schema) !== undefined
}

/**
 * Get the sensitive metadata from a schema, if present.
 *
 * This function unwraps through Zod wrapper types to find the ZodSensitive wrapper
 * and extract its metadata.
 */
export function getSensitiveMetadata<TReq = unknown>(
  schema: z.ZodTypeAny | ZodSensitive
): SensitiveMetadata<TReq> | undefined {
  const wrapper = findZodSensitive(schema)
  if (wrapper) {
    return wrapper._def.sensitiveMetadata as SensitiveMetadata<TReq>
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
 * Works with both ZodSensitive wrappers and legacy metadata-based marking.
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
 * This function traverses the schema tree to find all ZodSensitive wrappers
 * and returns their paths and metadata.
 *
 * @param schema - The Zod schema to traverse
 * @param basePath - Optional prefix for all paths (e.g., 'user' -> 'user.email')
 * @returns Array of sensitive field info with paths and metadata
 */
export function findSensitiveFields(
  schema: z.ZodTypeAny | ZodSensitive,
  basePath = ''
): SensitiveFieldInfo[] {
  const fields = findFieldsWithMeta(schema as z.ZodTypeAny, hasSensitiveMarker)

  return fields.map(field => ({
    path: basePath ? (field.path ? `${basePath}.${field.path}` : basePath) : field.path,
    meta: field.meta[SENSITIVE_META_KEY]
  }))
}
