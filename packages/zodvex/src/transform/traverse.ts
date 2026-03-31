/**
 * Schema traversal utilities.
 *
 * General-purpose utilities for walking and inspecting Zod schemas.
 */

import type { z } from 'zod'
import type { $ZodType } from '../zod-core'
import type { FieldInfo, SchemaVisitor, WalkSchemaOptions } from './types'

const METADATA_CACHE = new WeakMap<$ZodType, Record<string, unknown> | undefined>()

/**
 * Metadata key for ZodCustom wrappers (custom field types).
 */
const CUSTOM_META_KEY = 'zodvex:custom'

/**
 * Duck-type check for custom wrapper schema types.
 */
function isCustomWrapperDef(schema: any): boolean {
  return schema?._def?.type === 'sensitive' && typeof schema?.unwrap === 'function'
}

/**
 * Get metadata from a Zod schema.
 *
 * Handles both Zod's native .meta() and custom wrapper types.
 *
 * @example
 * ```ts
 * const schema = z.string().meta({ encrypted: true })
 * const meta = getMetadata(schema)
 * // => { encrypted: true }
 * ```
 */
export function getMetadata(schema: $ZodType): Record<string, unknown> | undefined {
  if (METADATA_CACHE.has(schema)) {
    return METADATA_CACHE.get(schema)
  }

  const visited = new Set<$ZodType>()
  let current: $ZodType | undefined = schema

  while (current) {
    if (visited.has(current)) return undefined
    visited.add(current)

    // Fast path: custom wrapper stores metadata directly
    if (isCustomWrapperDef(current)) {
      const customMeta = (current as any)._def.sensitiveMetadata
      const meta = { [CUSTOM_META_KEY]: customMeta }
      METADATA_CACHE.set(schema, meta)
      return meta
    }

    const meta = (current as any).meta?.() as Record<string, unknown> | undefined
    if (meta !== undefined) {
      METADATA_CACHE.set(schema, meta)
      return meta
    }

    current = unwrapOnce(current)
  }

  METADATA_CACHE.set(schema, undefined)
  return undefined
}

/**
 * Unwrap one layer of a Zod wrapper type.
 *
 * Peels off a single wrapper (optional, nullable, default, readonly, catch,
 * prefault, nonoptional, lazy, pipe, or sensitive) and returns the inner schema.
 * Returns `undefined` if the schema is not a wrapper.
 *
 * Zod v4 does not publicly type `_def` internals, so this function uses
 * `as any` casts — this is expected and mirrors what Zod's own traversal does.
 *
 * @param schema - A Zod schema that may be wrapped
 * @returns The inner schema, or `undefined` if not a wrapper type
 */
export function unwrapOnce(schema: $ZodType): $ZodType | undefined {
  const defType = (schema as any)._def?.type as string | undefined

  switch (defType) {
    case 'sensitive': {
      // Custom wrapper type - unwrap to inner schema
      return (schema as any)._zod?.def?.innerType ?? (schema as any)._def?.innerType
    }

    case 'optional':
    case 'nullable': {
      return (schema as any)._zod?.def?.innerType ?? (schema as any)._def?.innerType
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
 * Check if a schema has metadata matching a predicate.
 *
 * @example
 * ```ts
 * const schema = z.string().meta({ encrypted: true })
 * hasMetadata(schema, meta => meta.encrypted === true)
 * // => true
 * ```
 */
export function hasMetadata(
  schema: $ZodType,
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
  schema: $ZodType,
  visitor: SchemaVisitor,
  options?: WalkSchemaOptions
): void {
  const recursionStack = new Set<$ZodType>()
  const basePath = options?.path ?? ''

  function traverse(sch: $ZodType, currentPath: string, isOptional: boolean): void {
    // Prevent infinite recursion on circular schema references
    if (recursionStack.has(sch)) return
    recursionStack.add(sch)

    try {
      const defType = (sch as any)._def?.type as string | undefined
      const meta = getMetadata(sch)
      const info: FieldInfo = { path: currentPath, schema: sch, meta, isOptional }

      // Call onField for every schema node
      if (visitor.onField) {
        const result = visitor.onField(info)
        if (result === 'skip') return
      }

      // Dispatch based on schema type
      switch (defType) {
        case 'sensitive': {
          // Custom wrapper - already reported via onField, now traverse inner
          const inner = (sch as any)._zod?.def?.innerType ?? (sch as any)._def?.innerType
          if (inner) {
            traverse(inner, currentPath, isOptional)
          }
          return
        }

        case 'optional': {
          const inner = (sch as any)._zod.def.innerType
          traverse(inner, currentPath, true)
          return
        }

        case 'nullable': {
          const inner = (sch as any)._zod.def.innerType
          traverse(inner, currentPath, isOptional)
          return
        }

        case 'lazy': {
          const getter = (sch as any)._def?.getter
          if (typeof getter === 'function') {
            const inner = getter()
            traverse(inner, currentPath, isOptional)
          }
          return
        }

        case 'default':
        case 'catch':
        case 'readonly':
        case 'prefault':
        case 'nonoptional': {
          const inner = (sch as any)._def?.innerType as $ZodType | undefined
          if (inner) {
            traverse(inner, currentPath, isOptional)
          }
          return
        }

        case 'pipe': {
          const inner = (sch as any)._def?.in as $ZodType | undefined
          if (inner) {
            traverse(inner, currentPath, isOptional)
          }
          return
        }

        case 'object': {
          visitor.onObject?.(info)
          const shape = (sch as any).shape
          if (shape) {
            for (const [key, fieldSchema] of Object.entries(shape)) {
              const fieldPath = currentPath ? `${currentPath}.${key}` : key
              traverse(fieldSchema as $ZodType, fieldPath, false)
            }
          }
          return
        }

        case 'array': {
          visitor.onArray?.(info)
          const element = (sch as any).element
          if (element) {
            const arrayPath = currentPath ? `${currentPath}[]` : '[]'
            traverse(element, arrayPath, false)
          }
          return
        }

        case 'union': {
          const unionOptions = (sch as any)._def.options as $ZodType[] | undefined

          // Get options from either _def.options or _def.optionsMap
          const variantOptions =
            unionOptions ||
            ((sch as any)._def.optionsMap ? Array.from((sch as any)._def.optionsMap.values()) : [])

          visitor.onUnion?.(info, variantOptions as $ZodType[])

          for (const variant of variantOptions as $ZodType[]) {
            traverse(variant, currentPath, isOptional)
          }
          return
        }
      }

      // Primitives and other types are leaf nodes - nothing more to traverse
    } finally {
      recursionStack.delete(sch)
    }
  }

  traverse(schema, basePath, false)
}

/**
 * Find all fields in a schema where metadata matches a predicate.
 *
 * @overload Type guard version - returns narrowed meta type
 */
export function findFieldsWithMeta<TMeta extends Record<string, unknown>>(
  schema: $ZodType,
  predicate: (meta: Record<string, unknown> | undefined) => meta is TMeta
): Array<FieldInfo & { meta: TMeta }>

/**
 * @overload Boolean predicate version
 */
export function findFieldsWithMeta(
  schema: $ZodType,
  predicate: (meta: Record<string, unknown> | undefined) => boolean
): FieldInfo[]

/**
 * Find all fields in a schema where metadata matches a predicate.
 *
 * @example
 * ```ts
 * // Find all fields with 'pii' metadata
 * const piiFields = findFieldsWithMeta(
 *   userSchema,
 *   (meta) => meta?.pii === true
 * )
 * // => [{ path: 'email', schema: z.string(), meta: { pii: true } }, ...]
 * ```
 */
export function findFieldsWithMeta(
  schema: $ZodType,
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
