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

// Helper to check if a schema is a Date type through the registry
export function isDateSchema(schema: any): boolean {
  if (schema instanceof z.ZodDate) return true

  // Check through effects/pipelines
  if (schema instanceof z.ZodTransform || schema instanceof z.ZodPipe) {
    const def = schema._def as any
    const inner = def.schema || def.in || def.out
    if (inner && inner !== schema) {
      return isDateSchema(inner)
    }
  }

  // Check through optional/nullable
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isDateSchema(schema.unwrap())
  }

  return false
}