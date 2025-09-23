import { z } from 'zod'
import { zodToConvex } from './mapping'
import { findBaseCodec, isDateSchema } from './registry'

export type ConvexCodec<T> = {
  validator: any
  encode: (value: T) => any
  decode: (value: any) => T
  pick: <K extends keyof T>(keys: K[]) => ConvexCodec<Pick<T, K>>
}

export function convexCodec<T>(schema: z.ZodType<T>): ConvexCodec<T> {
  const validator = zodToConvex(schema)

  return {
    validator,
    encode: (value: T) => toConvexJS(schema, value),
    decode: (value: any) => fromConvexJS(value, schema),
    pick: <K extends keyof T>(keys: K[] | Record<K, true>) => {
      if (!(schema instanceof z.ZodObject)) {
        throw new Error('pick() can only be called on object schemas')
      }
      // Handle both array and object formats
      const pickObj = Array.isArray(keys)
        ? keys.reduce((acc, k) => ({ ...acc, [k]: true }), {} as any)
        : keys
      const pickedSchema = schema.pick(pickObj as any)
      return convexCodec(pickedSchema) as ConvexCodec<Pick<T, K>>
    }
  }
}

// Convert JS values to Convex-safe JSON (handle Dates, remove undefined)
export function toConvexJS(schema?: any, value?: any): any {
  // If no schema provided, do basic conversion
  if (!schema || arguments.length === 1) {
    value = schema
    return basicToConvex(value)
  }

  // Use schema-aware conversion
  return schemaToConvex(value, schema)
}

function basicToConvex(value: any): any {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof Date) return value.getTime()

  if (Array.isArray(value)) {
    return value.map(basicToConvex)
  }

  if (value && typeof value === 'object') {
    const result: any = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        result[k] = basicToConvex(v)
      }
    }
    return result
  }

  return value
}

function schemaToConvex(value: any, schema: any): any {
  if (value === undefined || value === null) return value

  // Check base codec registry first
  const codec = findBaseCodec(schema)
  if (codec) {
    return codec.toConvex(value, schema)
  }

  // Handle wrapper types
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    return schemaToConvex(value, schema.unwrap ? schema.unwrap() : schema._def.innerType)
  }

  // Handle Date specifically
  if (schema instanceof z.ZodDate && value instanceof Date) {
    return value.getTime()
  }

  // Handle arrays
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return value
    return value.map(item => schemaToConvex(item, schema.element))
  }

  // Handle objects
  if (schema instanceof z.ZodObject) {
    if (!value || typeof value !== 'object') return value
    const shape = schema.shape
    const result: any = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        result[k] = shape[k] ? schemaToConvex(v, shape[k]) : basicToConvex(v)
      }
    }
    return result
  }

  // Handle unions
  if (schema instanceof z.ZodUnion) {
    // Try each option to see which one matches
    for (const option of schema.options) {
      try {
        ;(option as any).parse(value) // Validate against this option
        return schemaToConvex(value, option)
      } catch {
        // Try next option
      }
    }
  }

  // Handle records
  if (schema instanceof z.ZodRecord) {
    if (!value || typeof value !== 'object') return value
    const result: any = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        result[k] = schemaToConvex(v, schema.valueType)
      }
    }
    return result
  }

  // Default passthrough
  return basicToConvex(value)
}

// Convert Convex JSON back to JS values (handle timestamps -> Dates)
export function fromConvexJS(value: any, schema: any): any {
  if (value === undefined || value === null) return value

  // Check base codec registry first
  const codec = findBaseCodec(schema)
  if (codec) {
    return codec.fromConvex(value, schema)
  }

  // Handle wrapper types
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    return fromConvexJS(value, schema.unwrap ? schema.unwrap() : schema._def.innerType)
  }

  // Handle Date specifically
  if (schema instanceof z.ZodDate && typeof value === 'number') {
    return new Date(value)
  }

  // Check if schema is a Date through effects/transforms
  if (isDateSchema(schema) && typeof value === 'number') {
    return new Date(value)
  }

  // Handle arrays
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return value
    return value.map(item => fromConvexJS(item, schema.element))
  }

  // Handle objects
  if (schema instanceof z.ZodObject) {
    if (!value || typeof value !== 'object') return value
    const shape = schema.shape
    const result: any = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = shape[k] ? fromConvexJS(v, shape[k]) : v
    }
    return result
  }

  // Handle unions
  if (schema instanceof z.ZodUnion) {
    // Try to decode with each option
    for (const option of schema.options) {
      try {
        const decoded = fromConvexJS(value, option)
        ;(option as any).parse(decoded) // Validate the decoded value
        return decoded
      } catch {
        // Try next option
      }
    }
  }

  // Handle records
  if (schema instanceof z.ZodRecord) {
    if (!value || typeof value !== 'object') return value
    const result: any = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = fromConvexJS(v, schema.valueType)
    }
    return result
  }

  // Handle effects and transforms
  if (schema instanceof z.ZodTransform || schema instanceof z.ZodPipe) {
    const def = schema._def as any
    const inner = def.schema || def.in || def.out
    if (inner && inner !== schema) {
      return fromConvexJS(value, inner)
    }
  }

  return value
}