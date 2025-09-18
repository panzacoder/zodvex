import { z } from 'zod'
import { getObjectShape, zodToConvex, zodToConvexFields } from './mapping'
import { findBaseCodec } from './registry'

export type ConvexCodec<T = any> = {
  schema: z.ZodTypeAny
  toConvexSchema: () => any
  encode: (data: T) => any
  decode: (data: any) => T
  pick: (keys: Record<string, true>) => ConvexCodec<any>
}

export function toConvexJS(value: any): any
export function toConvexJS(schema: z.ZodTypeAny, value: any): any
export function toConvexJS(schemaOrValue: any, value?: any): any {
  // If called with one argument, treat it as value without schema
  if (arguments.length === 1) {
    const val = schemaOrValue
    if (val === undefined) return undefined

    // Handle objects recursively
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      const out: any = {}
      for (const [k, v] of Object.entries(val)) {
        const converted = toConvexJS(v)
        if (converted !== undefined) out[k] = converted
      }
      return out
    }

    // Handle arrays
    if (Array.isArray(val)) {
      return val.map(item => toConvexJS(item))
    }

    // Convert dates to timestamps
    if (val instanceof Date) {
      return val.getTime()
    }

    return val
  }

  // Two arguments: use schema-based conversion
  const schema = schemaOrValue as z.ZodTypeAny
  if (value === undefined) return undefined

  if (schema instanceof z.ZodDefault) {
    return toConvexJS((schema as any).unwrap(), value)
  }
  if (schema instanceof z.ZodOptional) {
    if (value === undefined) return undefined
    return toConvexJS((schema as any).unwrap(), value)
  }
  if (schema instanceof z.ZodNullable) {
    if (value === null) return null
    return toConvexJS((schema as any).unwrap(), value)
  }
  // Pipeline: encode according to output side
  if ((schema as any) && (schema as any).type === 'pipe' && 'out' in (schema as any)) {
    return toConvexJS((schema as any).out as z.ZodTypeAny, value)
  }

  if (schema instanceof z.ZodObject && value && typeof value === 'object') {
    const shape = getObjectShape(schema)
    const out: any = {}
    for (const [k, child] of Object.entries(shape)) {
      const v = toConvexJS(child, (value as any)[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }

  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const el = (schema as z.ZodArray<any>).element as z.ZodTypeAny
    return value.map(item => toConvexJS(el, item))
  }

  // Base type registry encode fallback
  const base = findBaseCodec(schema)
  if (base) return base.encode(value, schema)
  return value
}

export function fromConvexJS(value: any, schema: z.ZodTypeAny): any {
  if (value === undefined) return undefined

  if ((schema as any) && (schema as any).type === 'pipe' && 'out' in (schema as any)) {
    return fromConvexJS(value, (schema as any).out as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodDefault) {
    return fromConvexJS(value, (schema as any).unwrap())
  }
  if (schema instanceof z.ZodOptional) {
    if (value === undefined) return undefined
    return fromConvexJS(value, (schema as any).unwrap())
  }
  if (schema instanceof z.ZodNullable) {
    if (value === null) return null
    return fromConvexJS(value, (schema as any).unwrap())
  }

  if (schema instanceof z.ZodObject && value && typeof value === 'object') {
    const shape = getObjectShape(schema)
    const out: any = {}
    for (const [k, child] of Object.entries(shape)) {
      if (k in (value as any)) out[k] = fromConvexJS((value as any)[k], child)
    }
    return out
  }

  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const el = (schema as z.ZodArray<any>).element as z.ZodTypeAny
    return value.map(item => fromConvexJS(item, el))
  }

  // Base type registry decode fallback
  const base = findBaseCodec(schema)
  if (base) return base.decode(value, schema)
  return value
}

export function convexCodec<T = any>(schema: z.ZodTypeAny): ConvexCodec<T> {
  const toConvexSchema = () => {
    if (schema instanceof z.ZodObject) {
      const shape = getObjectShape(schema)
      return zodToConvexFields(shape)
    }
    return zodToConvex(schema)
  }

  const encode = (data: any) => {
    const parsed = schema.parse(data)
    return toConvexJS(schema, parsed)
  }
  const decode = (data: any) => fromConvexJS(data, schema)

  const pick = (keys: Record<string, true>): ConvexCodec<any> => {
    if (!(schema instanceof z.ZodObject))
      throw new Error('pick() is only supported on ZodObject schemas')
    const picked = (schema as z.ZodObject<any>).pick(keys as any)
    return convexCodec(picked)
  }

  return { schema, toConvexSchema, encode, decode, pick }
}
