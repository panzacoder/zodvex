import { z } from 'zod'
import { v } from 'convex/values'

// Registry for base type codecs
type BaseCodec = {
  check: (schema: any) => boolean
  toValidator: (schema: any) => any
  fromConvex: (value: any, schema: any) => any
  toConvex: (value: any, schema: any) => any
}

const baseCodecs: BaseCodec[] = []

export function registerBaseCodec(codec: BaseCodec): void {
  baseCodecs.unshift(codec) // Add to front for priority
}

export function findBaseCodec(schema: any): BaseCodec | undefined {
  return baseCodecs.find(codec => codec.check(schema))
}

// Built-in codec for Date
registerBaseCodec({
  check: (schema) => schema instanceof z.ZodDate,
  toValidator: () => v.float64(),
  fromConvex: (value) => {
    if (typeof value === 'number') {
      return new Date(value)
    }
    return value
  },
  toConvex: (value) => {
    if (value instanceof Date) {
      return value.getTime()
    }
    return value
  }
})

// Helper to convert Zod's internal types to ZodTypeAny
function asZodType<T>(schema: T): z.ZodTypeAny {
  return schema as unknown as z.ZodTypeAny
}

// Helper to check if a schema is a Date type through the registry
export function isDateSchema(schema: any): boolean {
  if (schema instanceof z.ZodDate) return true

  // Check through optional/nullable (these have public unwrap())
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isDateSchema(asZodType(schema.unwrap()))
  }

  // Cannot check transforms/pipes without _def access
  // This is a limitation of using only public APIs

  return false
}