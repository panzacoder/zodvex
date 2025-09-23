import { type Validator, v } from 'convex/values'
import { z } from 'zod'
import { registryHelpers } from './ids'
import { findBaseCodec } from './registry'


// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export function getObjectShape(obj: any): Record<string, any> {
  // Use public API .shape property for ZodObject
  if (obj instanceof z.ZodObject) {
    return obj.shape
  }
  // Fallback for edge cases
  if (obj && typeof obj === 'object' && typeof obj.shape === 'object') {
    return obj.shape as Record<string, any>
  }
  return {}
}

// Two-pass approach: first analyze the schema to understand modifiers
export function analyzeZod(schema: z.ZodTypeAny): {
  base: z.ZodTypeAny
  optional: boolean
  nullable: boolean
  hasDefault: boolean
} {
  let s: z.ZodTypeAny = schema
  let optional = false
  let nullable = false
  let hasDefault = false

  // Unwrap modifiers
  while (s instanceof z.ZodDefault || s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    if (s instanceof z.ZodDefault) {
      hasDefault = true
      s = s.removeDefault() as z.ZodTypeAny
    } else if (s instanceof z.ZodOptional) {
      optional = true
      s = s.unwrap() as z.ZodTypeAny
    } else if (s instanceof z.ZodNullable) {
      nullable = true
      s = s.unwrap() as z.ZodTypeAny
    }
  }

  // Check for null in union types
  if (s instanceof z.ZodUnion) {
    const opts = s.options as z.ZodTypeAny[]
    if (opts && opts.some((o) => o instanceof z.ZodNull)) {
      nullable = true
    }
  }

  return { base: s, optional: optional || hasDefault, nullable, hasDefault }
}

// Simple conversion for base types without modifiers
export function simpleToConvex(schema: z.ZodTypeAny): any {
  const meta = analyzeZod(schema)
  const inner = meta.base

  // Check for custom Convex ID type
  try {
    const m = registryHelpers.getMetadata(inner as any)
    if (m?.isConvexId && m?.tableName && typeof m.tableName === 'string') {
      return v.id(m.tableName)
    }
  } catch {
    // ignore metadata errors
  }

  // Base type codec registry (for Date, etc.)
  const codec = findBaseCodec(inner as any)
  if (codec) {
    return codec.toValidator(inner)
  }

  // Handle all base Zod types
  if (inner instanceof z.ZodString) return v.string()
  if (inner instanceof z.ZodNumber) return v.float64()
  if (inner instanceof z.ZodBigInt) return v.int64()
  if (inner instanceof z.ZodBoolean) return v.boolean()
  if (inner instanceof z.ZodDate) return v.float64()
  if (inner instanceof z.ZodNull) return v.null()
  if (inner instanceof z.ZodAny || inner instanceof z.ZodUnknown) return v.any()
  if (inner instanceof z.ZodUndefined || inner instanceof z.ZodVoid || inner instanceof z.ZodNever) return v.any()

  if (inner instanceof z.ZodLiteral) {
    const value = inner.value
    if (value === undefined) return v.any()
    if (value === null) return v.null()
    return v.literal(value as string | number | bigint | boolean)
  }

  if (inner instanceof z.ZodEnum) {
    const values = inner.options || []
    return makeUnion(values.map((val: any) => v.literal(val)))
  }

  if (inner instanceof z.ZodUnion) {
    const opts = inner.options as z.ZodTypeAny[]
    const nonNull = opts.filter((o) => !(o instanceof z.ZodNull))
    const members = nonNull.map((o) => simpleToConvex(o))
    return makeUnion(members)
  }

  if (inner instanceof z.ZodDiscriminatedUnion) {
    const opts = (inner as any).options as any[]
    const members = opts.map((o: z.ZodTypeAny) => simpleToConvex(o))
    return makeUnion(members)
  }

  if (inner instanceof z.ZodArray) {
    const el = inner.element as z.ZodTypeAny
    return v.array(simpleToConvex(el))
  }

  if (inner instanceof z.ZodObject) {
    const shape = getObjectShape(inner)
    const fields: Record<string, any> = {}
    for (const [k, child] of Object.entries(shape)) {
      // Don't call convertWithMeta here - just simpleToConvex to avoid double recursion
      fields[k] = simpleToConvex(child as z.ZodTypeAny)
    }
    return v.object(fields)
  }

  if (inner instanceof z.ZodRecord) {
    // In Zod v4, z.record() has two forms:
    // - Single arg: z.record(valueType) - valueType is stored in keyType, keys are strings
    // - Two args: z.record(keyType, valueType) - both are stored properly
    const valueType = (inner.valueType || inner.keyType) as z.ZodTypeAny
    return v.record(v.string(), simpleToConvex(valueType))
  }

  if (inner instanceof z.ZodTuple) {
    // Cannot access items without _def, map to generic array
    return v.array(v.any())
  }

  if (inner instanceof z.ZodIntersection) {
    // Cannot access left/right schemas without _def, map to any
    return v.any()
  }

  if (inner instanceof z.ZodLazy) {
    // Lazy schemas are typically for recursive types which Convex doesn't support
    return v.any()
  }

  if (inner instanceof z.ZodTransform || inner instanceof z.ZodPipe) {
    // Cannot access inner schema without _def, map to any
    return v.any()
  }

  return v.any()
}

// Second pass: apply modifiers to the base validator
export function convertWithMeta(zodField: z.ZodTypeAny, baseValidator: any): any {
  const meta = analyzeZod(zodField)
  let core = baseValidator

  const inner = meta.base
  if (inner instanceof z.ZodObject) {
    const childShape = getObjectShape(inner as any)
    const baseChildren: Record<string, any> = Object.fromEntries(
      Object.entries(childShape).map(([k, v]) => [k, simpleToConvex(v as z.ZodTypeAny)])
    )
    const rebuiltChildren: Record<string, any> = {}
    for (const [k, childZ] of Object.entries(childShape)) {
      rebuiltChildren[k] = convertWithMeta(childZ as z.ZodTypeAny, baseChildren[k])
    }
    core = v.object(rebuiltChildren)
  } else if (inner instanceof z.ZodArray) {
    const elZod = inner.element as z.ZodTypeAny
    const baseEl = simpleToConvex(elZod)
    const rebuiltEl = convertWithMeta(elZod, baseEl)
    core = v.array(rebuiltEl)
  }

  // Apply modifiers
  if (meta.nullable) {
    core = makeUnion([core, v.null()])
  }
  if (meta.optional) {
    core = v.optional(core)
  }
  return core
}

// Main conversion function using two-pass approach
export function zodToConvex(schema: z.ZodTypeAny): Validator<any, any, any> {
  return convertWithMeta(schema, simpleToConvex(schema))
}

export function zodToConvexFields(schemaOrShape: any): Record<string, any> {
  // Handle both ZodObject and plain shape objects
  const shape = schemaOrShape instanceof z.ZodObject
    ? getObjectShape(schemaOrShape)
    : schemaOrShape

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(shape)) {
    result[key] = convertWithMeta(value as z.ZodTypeAny, simpleToConvex(value as z.ZodTypeAny))
  }
  return result
}