import { type Validator, v } from 'convex/values'
import { z } from 'zod'
import { registryHelpers } from './ids'
import { findBaseCodec } from './registry'

// Zod v4 uses $ZodType internally, but it's compatible with ZodType at runtime
// This helper ensures type compatibility without using 'as any'
function asZodType<T>(schema: T): z.ZodTypeAny {
  // Runtime: this is always safe as Zod's internal types are ZodType instances
  // TypeScript: we're asserting the type system's limitation
  return schema as unknown as z.ZodTypeAny
}

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

// Main conversion function that handles modifiers recursively
export function zodToConvex(schema: z.ZodTypeAny): Validator<any, any, any> {
  // Handle modifier types by recursively converting inner type
  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap()
    return v.optional(zodToConvex(asZodType(inner)))
  }

  if (schema instanceof z.ZodNullable) {
    const inner = schema.unwrap()
    // If inner is optional, we need to handle it specially
    if (inner instanceof z.ZodOptional) {
      const innerInner = inner.unwrap()
      return v.optional(v.union(zodToConvex(asZodType(innerInner)), v.null()))
    }
    return v.union(zodToConvex(asZodType(inner)), v.null())
  }

  if (schema instanceof z.ZodDefault) {
    const inner = schema.removeDefault()
    return v.optional(zodToConvex(asZodType(inner)))
  }


  if (schema instanceof z.ZodPipe) {
    // Cannot access inner schema without _def, map to any
    return v.any()
  }

  // All base types handled here
  return convertBaseType(schema)
}

// Convert base Zod types (no modifiers) to Convex validators
function convertBaseType(schema: z.ZodTypeAny): any {
  // Check for custom Convex ID type
  try {
    const m = registryHelpers.getMetadata(schema as any)
    if (m?.isConvexId && m?.tableName && typeof m.tableName === 'string') {
      return v.id(m.tableName)
    }
  } catch {
    // ignore metadata errors
  }

  // Base type codec registry (for Date, etc.)
  const codec = findBaseCodec(schema as any)
  if (codec) {
    return codec.toValidator(schema)
  }

  // Handle all base Zod types
  if (schema instanceof z.ZodString) {
    return v.string()
  }
  if (schema instanceof z.ZodNumber) {
    return v.float64()
  }
  if (schema instanceof z.ZodBigInt) {
    return v.int64()
  }
  if (schema instanceof z.ZodBoolean) {
    return v.boolean()
  }
  if (schema instanceof z.ZodDate) {
    return v.float64() // Dates stored as timestamps
  }
  if (schema instanceof z.ZodNull) {
    return v.null()
  }
  if (schema instanceof z.ZodUndefined || schema instanceof z.ZodVoid || schema instanceof z.ZodNever) {
    return v.any()
  }
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return v.any()
  }
  if (schema instanceof z.ZodLiteral) {
    // ZodLiteral.value can be undefined or null
    // Convex doesn't support undefined literals, so map to any
    const value = schema.value
    if (value === undefined) {
      return v.any()
    }
    if (value === null) {
      return v.null()
    }
    return v.literal(value as string | number | bigint | boolean)
  }
  if (schema instanceof z.ZodEnum) {
    // Use public .options property for enum values
    const values = schema.options || []
    return makeUnion(values.map((val: any) => v.literal(val)))
  }
  if (schema instanceof z.ZodUnion) {
    const opts = schema.options
    const members = opts.map(o => zodToConvex(asZodType(o)))
    return makeUnion(members)
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const opts = (schema as any).options as any[]
    const members = opts.map((o: any) => zodToConvex(o))
    return makeUnion(members)
  }
  if (schema instanceof z.ZodArray) {
    const element = schema.element
    return v.array(zodToConvex(asZodType(element)))
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape
    const fields: Record<string, any> = {}
    for (const [k, child] of Object.entries(shape)) {
      fields[k] = zodToConvex(child as z.ZodTypeAny)
    }
    return v.object(fields)
  }
  if (schema instanceof z.ZodRecord) {
    // Use public .keyType and .valueType properties
    const valueType = schema.valueType || schema.keyType
    return v.record(v.string(), valueType ? zodToConvex(asZodType(valueType)) : v.string())
  }
  if (schema instanceof z.ZodTuple) {
    // Cannot access items without _def, map to generic array
    return v.array(v.any())
  }
  if (schema instanceof z.ZodIntersection) {
    // Cannot access left/right schemas without _def, map to any
    return v.any()
  }
  if (schema instanceof z.ZodLazy) {
    // Cannot access getter without _def, map to any
    // Lazy schemas are typically for recursive types which Convex doesn't support
    return v.any()
  }
  if (schema instanceof z.ZodTransform) {
    // Cannot access input schema without _def, map to any
    return v.any()
  }

  // Fallback for unknown types
  return v.any()
}

export function zodToConvexFields(schemaOrShape: any): Record<string, any> {
  // Handle both ZodObject and plain shape objects
  const shape = schemaOrShape instanceof z.ZodObject
    ? schemaOrShape.shape
    : schemaOrShape

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(shape)) {
    result[key] = zodToConvex(value as z.ZodTypeAny)
  }
  return result
}

// For backwards compatibility - will be removed
export function simpleToConvex(schema: any): any {
  return convertBaseType(schema)
}