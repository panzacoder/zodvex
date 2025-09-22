import { v } from 'convex/values'
// no direct import from zod v4 here; we use structural checks via z4 helpers
import { getDef, isZ4Schema } from './z4'

export interface BaseTypeCodec {
  match: (schema: any) => boolean
  toValidator: (schema: any) => any
  encode: (value: any, schema: any) => any
  decode: (value: any, schema: any) => any
}

const baseCodecs: BaseTypeCodec[] = []

export function registerBaseCodec(codec: BaseTypeCodec) {
  baseCodecs.unshift(codec)
}

export function findBaseCodec(schema: any): BaseTypeCodec | undefined {
  return baseCodecs.find(c => c.match(schema))
}

// Default codecs for supported base types
registerBaseCodec({
  match: (s) => isZ4Schema(s) && getDef(s).type === 'string',
  toValidator: () => v.string(),
  encode: (val) => val,
  decode: (val) => val
})

registerBaseCodec({
  match: (s) => isZ4Schema(s) && getDef(s).type === 'number',
  toValidator: () => v.float64(),
  encode: (val) => val,
  decode: (val) => val
})

registerBaseCodec({
  match: (s) => isZ4Schema(s) && getDef(s).type === 'boolean',
  toValidator: () => v.boolean(),
  encode: (val) => val,
  decode: (val) => val
})

registerBaseCodec({
  match: (s) => isZ4Schema(s) && getDef(s).type === 'date',
  toValidator: () => v.float64(),
  encode: (val) => (val instanceof Date ? val.getTime() : val),
  decode: (val) => (typeof val === 'number' ? new Date(val) : val)
})

registerBaseCodec({
  match: (s) => isZ4Schema(s) && getDef(s).type === 'null',
  toValidator: () => v.null(),
  encode: (val) => val,
  decode: (val) => val
})
