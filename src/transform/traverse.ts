/**
 * Schema traversal utilities.
 *
 * General-purpose utilities for walking and inspecting Zod schemas.
 */

import type { z } from 'zod'
import type { FieldInfo, SchemaVisitor, WalkSchemaOptions } from './types'

/**
 * Get metadata from a Zod schema.
 *
 * @example
 * ```ts
 * const schema = z.string().meta({ encrypted: true })
 * const meta = getMetadata(schema)
 * // => { encrypted: true }
 * ```
 */
export function getMetadata(schema: z.ZodTypeAny): Record<string, unknown> | undefined {
  return schema.meta?.() as Record<string, unknown> | undefined
}

/**
 * Check if a schema has metadata matching a predicate.
 *
 * @example
 * ```ts
 * const schema = z.string().meta({ sensitive: true })
 * hasMetadata(schema, meta => meta.sensitive === true)
 * // => true
 * ```
 */
export function hasMetadata(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown>) => boolean
): boolean {
  const meta = getMetadata(schema)
  return meta !== undefined && predicate(meta)
}

/**
 * Walk a Zod schema, calling visitor functions for each node.
 *
 * Handles: objects, arrays, optionals, nullables, unions, discriminated unions.
 * Prevents infinite recursion on circular schema references.
 *
 * @example
 * ```ts
 * walkSchema(userSchema, {
 *   onField: (info) => {
 *     if (info.meta?.encrypted) {
 *       console.log(`Encrypted field: ${info.path}`)
 *     }
 *   }
 * })
 * ```
 */
export function walkSchema(
  schema: z.ZodTypeAny,
  visitor: SchemaVisitor,
  options?: WalkSchemaOptions
): void {
  const visited = new Set<z.ZodTypeAny>()
  const basePath = options?.path ?? ''

  function traverse(sch: z.ZodTypeAny, currentPath: string, isOptional: boolean): void {
    // Prevent infinite recursion on same schema instance
    if (visited.has(sch)) return
    visited.add(sch)

    const defType = (sch as any)._def?.type
    const meta = getMetadata(sch)
    const info: FieldInfo = { path: currentPath, schema: sch, meta, isOptional }

    // Call onField for every schema node
    if (visitor.onField) {
      const result = visitor.onField(info)
      if (result === 'skip') return
    }

    // Handle optional - unwrap and continue
    if (defType === 'optional') {
      const inner = (sch as any).unwrap()
      traverse(inner, currentPath, true)
      return
    }

    // Handle nullable - unwrap and continue
    if (defType === 'nullable') {
      const inner = (sch as any).unwrap()
      traverse(inner, currentPath, isOptional)
      return
    }

    // Handle lazy - unwrap and continue (the visited Set prevents infinite recursion)
    if (defType === 'lazy') {
      const getter = (sch as any)._def?.getter
      if (typeof getter === 'function') {
        const inner = getter()
        traverse(inner, currentPath, isOptional)
      }
      return
    }

    // Handle objects
    if (defType === 'object') {
      visitor.onObject?.(info)
      const shape = (sch as any).shape
      if (shape) {
        for (const [key, fieldSchema] of Object.entries(shape)) {
          const fieldPath = currentPath ? `${currentPath}.${key}` : key
          traverse(fieldSchema as z.ZodTypeAny, fieldPath, false)
        }
      }
      return
    }

    // Handle arrays
    if (defType === 'array') {
      visitor.onArray?.(info)
      const element = (sch as any).element
      if (element) {
        const arrayPath = currentPath ? `${currentPath}[]` : '[]'
        traverse(element, arrayPath, false)
      }
      return
    }

    // Handle unions (including discriminated unions)
    if (defType === 'union') {
      const unionOptions = (sch as any)._def.options as z.ZodTypeAny[] | undefined

      // Get options from either _def.options or _def.optionsMap
      const variantOptions =
        unionOptions ||
        ((sch as any)._def.optionsMap ? Array.from((sch as any)._def.optionsMap.values()) : [])

      visitor.onUnion?.(info, variantOptions as z.ZodTypeAny[])

      for (const variant of variantOptions as z.ZodTypeAny[]) {
        traverse(variant, currentPath, isOptional)
      }
      return
    }

    // Primitives and other types are leaf nodes - nothing more to traverse
  }

  traverse(schema, basePath, false)
}

/**
 * Find all fields in a schema where metadata matches a predicate.
 *
 * @overload Type guard version - returns narrowed meta type
 */
export function findFieldsWithMeta<TMeta extends Record<string, unknown>>(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown> | undefined) => meta is TMeta
): Array<FieldInfo & { meta: TMeta }>

/**
 * @overload Boolean predicate version
 */
export function findFieldsWithMeta(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown> | undefined) => boolean
): FieldInfo[]

/**
 * Find all fields in a schema where metadata matches a predicate.
 *
 * @example
 * ```ts
 * // Find all fields with 'sensitive' metadata
 * const sensitiveFields = findFieldsWithMeta(
 *   userSchema,
 *   (meta) => meta?.sensitive === true
 * )
 * // => [{ path: 'email', schema: z.string(), meta: { sensitive: true } }, ...]
 * ```
 */
export function findFieldsWithMeta(
  schema: z.ZodTypeAny,
  predicate: (meta: Record<string, unknown> | undefined) => boolean
): FieldInfo[] {
  const results: FieldInfo[] = []

  walkSchema(schema, {
    onField: info => {
      if (predicate(info.meta)) {
        results.push(info)
        return 'skip' // Don't recurse into matching fields
      }
    }
  })

  return results
}
