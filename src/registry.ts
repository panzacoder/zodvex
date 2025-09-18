import { v } from 'convex/values'
import { z } from 'zod'

export interface BaseTypeCodec {
  match: (schema: z.ZodTypeAny) => boolean
  toValidator: (schema: z.ZodTypeAny) => any
  encode: (value: any, schema: z.ZodTypeAny) => any
  decode: (value: any, schema: z.ZodTypeAny) => any
}

const baseCodecs: BaseTypeCodec[] = []

export function registerBaseCodec(codec: BaseTypeCodec) {
  baseCodecs.unshift(codec)
}

export function findBaseCodec(schema: z.ZodTypeAny): BaseTypeCodec | undefined {
  return baseCodecs.find(c => c.match(schema))
}

// Default codecs for supported base types
registerBaseCodec({
  match: (s) => s instanceof z.ZodString,
  toValidator: () => v.string(),
  encode: (val) => val,
  decode: (val) => val
})

registerBaseCodec({
  match: (s) => s instanceof z.ZodNumber,
  toValidator: () => v.float64(),
  encode: (val) => val,
  decode: (val) => val
})

registerBaseCodec({
  match: (s) => s instanceof z.ZodBoolean,
  toValidator: () => v.boolean(),
  encode: (val) => val,
  decode: (val) => val
})

registerBaseCodec({
  match: (s) => s instanceof z.ZodDate,
  toValidator: () => v.float64(),
  encode: (val) => (val instanceof Date ? val.getTime() : val),
  decode: (val) => (typeof val === 'number' ? new Date(val) : val)
})

registerBaseCodec({
  match: (s) => s instanceof z.ZodNull,
  toValidator: () => v.null(),
  encode: (val) => val,
  decode: (val) => val
})

