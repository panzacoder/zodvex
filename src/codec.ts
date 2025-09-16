import { z } from 'zod'
import { zodToConvex, zodToConvexFields, getObjectShape } from './mapping'

export type ConvexCodec<T = any> = {
  schema: z.ZodTypeAny
  toConvexSchema: () => any
  encode: (data: T) => any
  decode: (data: any) => T
  pick: (keys: Record<string, true>) => ConvexCodec<any>
}

export function toConvexJS(schema: z.ZodTypeAny, value: any): any {
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
    return toConvexJS(((schema as any).out as z.ZodTypeAny), value)
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
    return value.map((item) => toConvexJS(el, item))
  }

  if (schema instanceof z.ZodDate && value instanceof Date) {
    return value.getTime()
  }
  return value
}

export function fromConvexJS(schema: z.ZodTypeAny, value: any): any {
  if (value === undefined) return undefined

  if ((schema as any) && (schema as any).type === 'pipe' && 'out' in (schema as any)) {
    return fromConvexJS(((schema as any).out as z.ZodTypeAny), value)
  }
  if (schema instanceof z.ZodDefault) {
    return fromConvexJS((schema as any).unwrap(), value)
  }
  if (schema instanceof z.ZodOptional) {
    if (value === undefined) return undefined
    return fromConvexJS((schema as any).unwrap(), value)
  }
  if (schema instanceof z.ZodNullable) {
    if (value === null) return null
    return fromConvexJS((schema as any).unwrap(), value)
  }

  if (schema instanceof z.ZodObject && value && typeof value === 'object') {
    const shape = getObjectShape(schema)
    const out: any = {}
    for (const [k, child] of Object.entries(shape)) {
      if (k in (value as any)) out[k] = fromConvexJS(child, (value as any)[k])
    }
    return out
  }

  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const el = (schema as z.ZodArray<any>).element as z.ZodTypeAny
    return value.map((item) => fromConvexJS(el, item))
  }

  if (schema instanceof z.ZodDate && typeof value === 'number') {
    return new Date(value)
  }
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
  const decode = (data: any) => fromConvexJS(schema, data)

  const pick = (keys: Record<string, true>): ConvexCodec<any> => {
    if (!(schema instanceof z.ZodObject)) throw new Error('pick() is only supported on ZodObject schemas')
    const picked = (schema as z.ZodObject<any>).pick(keys as any)
    return convexCodec(picked)
  }

  return { schema, toConvexSchema, encode, decode, pick }
}

