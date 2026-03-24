/**
 * Runtime schema introspection utilities.
 *
 * Provides stable APIs for inspecting Zod schemas without accessing
 * private _def properties. Built on zodvex's existing schema parsing
 * from transform/traverse.ts, mapping/core.ts, and ids.ts.
 */

import { z } from 'zod'
import { registryHelpers } from './ids'
import { isZid } from './mapping/utils'
import { getMetadata, unwrapOnce } from './transform/traverse'

/**
 * Comprehensive schema metadata extracted from a Zod schema.
 */
export interface SchemaIntrospection {
  /** The underlying type after unwrapping optional/nullable/default */
  baseType:
    | 'string'
    | 'number'
    | 'bigint'
    | 'boolean'
    | 'date'
    | 'null'
    | 'literal'
    | 'object'
    | 'array'
    | 'union'
    | 'enum'
    | 'record'
    | 'tuple'
    | 'unknown'

  /** Whether the schema is wrapped in ZodOptional */
  isOptional: boolean
  /** Whether the schema is wrapped in ZodNullable */
  isNullable: boolean
  /** Whether the schema is wrapped in ZodReadonly */
  isReadonly: boolean

  /** Whether the schema has a default value */
  hasDefault: boolean
  /** The default value, if any */
  defaultValue?: unknown

  /** Whether this is a Convex ID (zid / zx.id) */
  isConvexId: boolean
  /** The Convex table name, if this is a Convex ID */
  tableName?: string

  /** Container details — present only for compound types */
  arrayElement?: SchemaIntrospection
  objectShape?: Record<string, SchemaIntrospection>
  unionOptions?: SchemaIntrospection[]
  enumValues?: readonly string[]

  /** Literal value, if baseType is 'literal' */
  literalValue?: unknown

  /** Description from .describe(), if present */
  description?: string

  /** User-defined metadata from .meta(), if present */
  meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Introspect a Zod schema to extract comprehensive metadata.
 *
 * @example
 * ```ts
 * import { introspect } from 'zodvex'
 *
 * const info = introspect(z.string().email().optional())
 * // { baseType: 'string', isOptional: true, isNullable: false, ... }
 *
 * const idInfo = introspect(zx.id('users'))
 * // { baseType: 'string', isConvexId: true, tableName: 'users', ... }
 * ```
 */
export function introspect(schema: z.ZodTypeAny): SchemaIntrospection {
  return introspectInternal(schema)
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Check if a schema represents a Convex ID (zid / zx.id).
 *
 * @example
 * ```ts
 * isConvexId(zx.id('users'))       // true
 * isConvexId(z.string())           // false
 * isConvexId(zx.id('users').optional()) // true
 * ```
 */
export function isConvexId(schema: z.ZodTypeAny): boolean {
  return introspect(schema).isConvexId
}

/**
 * Get the Convex table name from a Convex ID schema.
 *
 * @returns The table name, or `undefined` if the schema is not a Convex ID.
 */
export function getTableName(schema: z.ZodTypeAny): string | undefined {
  const info = introspect(schema)
  return info.isConvexId ? info.tableName : undefined
}

/**
 * Check if a schema is optional.
 */
export function isOptional(schema: z.ZodTypeAny): boolean {
  return introspect(schema).isOptional
}

/**
 * Check if a schema is nullable.
 */
export function isNullable(schema: z.ZodTypeAny): boolean {
  return introspect(schema).isNullable
}

/**
 * Check if a schema has a default value.
 */
export function hasDefault(schema: z.ZodTypeAny): boolean {
  return introspect(schema).hasDefault
}

/**
 * Get the default value from a schema, or `undefined` if none.
 */
export function getDefault(schema: z.ZodTypeAny): unknown {
  const info = introspect(schema)
  return info.hasDefault ? info.defaultValue : undefined
}

/**
 * Get the base type of a schema (after unwrapping optional/nullable/default).
 */
export function getBaseType(schema: z.ZodTypeAny): SchemaIntrospection['baseType'] {
  return introspect(schema).baseType
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Unwrap all wrapper layers, collecting wrapper information along the way.
 */
function unwrapAll(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny
  isOptional: boolean
  isNullable: boolean
  isReadonly: boolean
  hasDefault: boolean
  defaultValue: unknown
} {
  let current = schema
  let opt = false
  let nullable = false
  let readonly_ = false
  let hasDef = false
  let defValue: unknown = undefined
  const visited = new Set<z.ZodTypeAny>()

  while (current) {
    if (visited.has(current)) break
    visited.add(current)

    const defType = (current as any)._def?.type ?? (current as any).def?.type

    switch (defType) {
      case 'optional':
        opt = true
        current = (current as any).unwrap?.() ?? (current as any)._def?.innerType
        continue
      case 'nullable':
        nullable = true
        current = (current as any).unwrap?.() ?? (current as any)._def?.innerType
        continue
      case 'default': {
        hasDef = true
        defValue = (current as any)._def?.defaultValue ?? (current as any).def?.defaultValue
        if (typeof defValue === 'function') {
          try {
            defValue = defValue()
          } catch {
            defValue = undefined
          }
        }
        current = (current as any)._def?.innerType
        continue
      }
      case 'readonly':
        readonly_ = true
        current = (current as any)._def?.innerType
        continue
      case 'catch':
      case 'prefault':
      case 'nonoptional':
        current = (current as any)._def?.innerType
        continue
      case 'lazy': {
        const getter = (current as any)._def?.getter
        if (typeof getter === 'function') {
          current = getter()
          continue
        }
        break
      }
      default:
        // Not a wrapper — stop unwrapping
        break
    }
    break
  }

  return {
    inner: current,
    isOptional: opt,
    isNullable: nullable,
    isReadonly: readonly_,
    hasDefault: hasDef,
    defaultValue: defValue
  }
}

/**
 * Detect the base type from a Zod schema's def.type, mirroring mapping/core.ts logic.
 */
function detectBaseType(schema: z.ZodTypeAny): SchemaIntrospection['baseType'] {
  const defType = (schema as any)._def?.type ?? (schema as any).def?.type

  switch (defType) {
    case 'string':
      return 'string'
    case 'number':
    case 'nan':
      return 'number'
    case 'bigint':
      return 'bigint'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'null':
      return 'null'
    case 'literal':
      return 'literal'
    case 'object':
      return 'object'
    case 'array':
      return 'array'
    case 'union':
    case 'discriminatedUnion':
      return 'union'
    case 'enum':
      return 'enum'
    case 'record':
      return 'record'
    case 'tuple':
      return 'tuple'
    case 'pipe':
    case 'transform': {
      // For codecs/pipes, detect the input schema type
      const inputSchema = (schema as any)._def?.in
      if (inputSchema && inputSchema instanceof z.ZodType) {
        return detectBaseType(inputSchema)
      }
      return 'unknown'
    }
    default:
      return 'unknown'
  }
}

/**
 * Check if an unwrapped schema is a Convex ID. Handles the case where
 * the zid was wrapped in optional/nullable before we see it.
 */
function detectConvexId(schema: z.ZodTypeAny): { isConvexId: boolean; tableName?: string } {
  // Direct registry check (handles both zid() and zx.id())
  if (isZid(schema)) {
    const meta = registryHelpers.getMetadata(schema)
    return {
      isConvexId: true,
      tableName: meta?.tableName ?? (schema as any)._tableName
    }
  }

  // Check _tableName property directly
  const tableName = (schema as any)?._tableName
  if (typeof tableName === 'string' && tableName.length > 0) {
    return { isConvexId: true, tableName }
  }

  // Check description pattern "convexId:tableName"
  const desc = (schema as any)._def?.description ?? (schema as any).description
  if (typeof desc === 'string' && desc.startsWith('convexId:')) {
    return { isConvexId: true, tableName: desc.slice('convexId:'.length) }
  }

  return { isConvexId: false }
}

function introspectInternal(schema: z.ZodTypeAny): SchemaIntrospection {
  const {
    inner,
    isOptional: opt,
    isNullable: nullable,
    isReadonly: readonly_,
    hasDefault: hasDef,
    defaultValue: defVal
  } = unwrapAll(schema)

  // Convex ID detection on the unwrapped schema
  const idInfo = detectConvexId(inner)

  // Base type detection
  const baseType = idInfo.isConvexId ? 'string' : detectBaseType(inner)

  // Metadata
  const meta = getMetadata(schema)

  // Description — Zod v4 stores .describe() as a direct property, not in _def
  const description = (schema as any).description ?? (inner as any).description ?? undefined

  // Build result
  const result: SchemaIntrospection = {
    baseType,
    isOptional: opt,
    isNullable: nullable,
    isReadonly: readonly_,
    hasDefault: hasDef,
    isConvexId: idInfo.isConvexId,
    ...(idInfo.tableName !== undefined && { tableName: idInfo.tableName }),
    ...(hasDef && { defaultValue: defVal }),
    ...(description !== undefined && { description }),
    ...(meta !== undefined && { meta })
  }

  // Container details
  switch (baseType) {
    case 'array': {
      const element = (inner as any).element ?? (inner as any)._def?.element
      if (element && element instanceof z.ZodType) {
        result.arrayElement = introspectInternal(element)
      }
      break
    }
    case 'object': {
      const shape = (inner as any).shape
      if (shape && typeof shape === 'object') {
        result.objectShape = {}
        for (const [key, fieldSchema] of Object.entries(shape)) {
          if (fieldSchema && fieldSchema instanceof z.ZodType) {
            result.objectShape[key] = introspectInternal(fieldSchema as z.ZodTypeAny)
          }
        }
      }
      break
    }
    case 'union': {
      const defType = (inner as any)._def?.type ?? (inner as any).def?.type
      let options: z.ZodTypeAny[] | undefined

      if (defType === 'discriminatedUnion') {
        const optionsMap = (inner as any)._def?.optionsMap
        if (optionsMap) {
          options = Array.from(optionsMap.values()) as z.ZodTypeAny[]
        }
      }
      if (!options) {
        options = (inner as any)._def?.options as z.ZodTypeAny[] | undefined
      }

      if (options && Array.isArray(options)) {
        result.unionOptions = options.map(opt => introspectInternal(opt))
      }
      break
    }
    case 'enum': {
      if (inner instanceof z.ZodEnum) {
        result.enumValues = (inner as any)._def?.entries as readonly string[] | undefined
        // Fallback: try .options or .enum
        if (!result.enumValues) {
          result.enumValues = (inner as any).options ?? (inner as any).enum?._def?.entries
        }
      }
      break
    }
    case 'literal': {
      result.literalValue = (inner as any).value ?? (inner as any)._def?.value
      break
    }
  }

  return result
}
