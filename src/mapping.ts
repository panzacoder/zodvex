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

// Main conversion function that handles modifiers recursively
export function zodToConvex(schema: z.ZodTypeAny): Validator<any, any, any> {
  // Handle modifier types by recursively converting inner type
  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap()
    return v.optional(zodToConvex(inner))
  }

  if (schema instanceof z.ZodNullable) {
    const inner = schema.unwrap()
    // If inner is optional, we need to handle it specially
    if (inner instanceof z.ZodOptional) {
      const innerInner = inner.unwrap()
      return v.optional(v.union(zodToConvex(innerInner), v.null()))
    }
    return v.union(zodToConvex(inner), v.null())
  }

  if (schema instanceof z.ZodDefault) {
    const inner = schema.removeDefault()
    return v.optional(zodToConvex(inner))
  }


  if (schema instanceof z.ZodPipe) {
    // For pipes, use the input schema for validation
    const def = (schema as any)._def
    if (def?.in) {
      return zodToConvex(def.in)
    }
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
    return v.literal((schema as any).value)
  }
  if (schema instanceof z.ZodEnum) {
    // Check if it's a native enum (has .enum property) or regular enum (has .options)
    const values = 'enum' in schema ? Object.values((schema as any).enum) : (schema as any).options || []
    return makeUnion(values.map((val: any) => v.literal(val as any)))
  }
  if (schema instanceof z.ZodUnion) {
    const opts = schema.options as any[]
    const members = opts.map(o => zodToConvex(o))
    return makeUnion(members)
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const opts = (schema as any).options as any[]
    const members = opts.map((o: any) => zodToConvex(o))
    return makeUnion(members)
  }
  if (schema instanceof z.ZodArray) {
    const element = schema.element
    return v.array(zodToConvex(element))
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
    // ZodRecord has .keyType and .valueType properties
    // If valueType is undefined, it means z.record(keyType) was used (value defaults to key type)
    const valueType = (schema as any).valueType || (schema as any).keyType
    return v.record(v.string(), valueType ? zodToConvex(valueType) : v.string())
  }
  if (schema instanceof z.ZodTuple) {
    const items = (schema as any).items || []
    const member = items.length ? makeUnion(items.map((i: any) => zodToConvex(i))) : v.any()
    return v.array(member)
  }
  if (schema instanceof z.ZodIntersection) {
    const left = (schema as any)._def.left
    const right = (schema as any)._def.right
    if (left instanceof z.ZodObject && right instanceof z.ZodObject) {
      const l = left.shape
      const r = right.shape
      const keys = new Set([...Object.keys(l), ...Object.keys(r)])
      const fields: Record<string, any> = {}
      for (const k of keys) {
        const lz = l[k]
        const rz = r[k]
        if (lz && rz) {
          // For overlapping keys, create a union (this is a simplification)
          fields[k] = makeUnion([zodToConvex(lz), zodToConvex(rz)])
        } else {
          fields[k] = zodToConvex((lz || rz) as any)
        }
      }
      return v.object(fields)
    }
    return v.any()
  }
  if (schema instanceof z.ZodLazy) {
    // Try to get the schema, but fallback to any if it fails
    try {
      const resolved = (schema as any)._def.getter()
      return zodToConvex(resolved)
    } catch {
      return v.any()
    }
  }
  if (schema instanceof z.ZodTransform) {
    // For transforms, use the input schema for validation
    const def = (schema as any)._def
    const innerSchema = def?.schema
    if (innerSchema && innerSchema !== schema) {
      return zodToConvex(innerSchema)
    }
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