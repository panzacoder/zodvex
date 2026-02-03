import { z } from 'zod'
import { zodToConvex } from './mapping'
import { type ZodvexCodec } from './types'

// Re-export ZodvexCodec type for convenience
export { type ZodvexCodec } from './types'

// Helper to convert Zod's internal types to ZodTypeAny
function asZodType<T>(schema: T): z.ZodTypeAny {
  return schema as unknown as z.ZodTypeAny
}

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
    encode: (value: T) => z.encode(schema, value),
    decode: (value: any) => schema.parse(value),
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
// NOTE: This is an internal function. Use z.encode() for encoding instead.
function toConvexJS(schema?: any, value?: any): any {
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

  // Check for native ZodCodec first (including zodvexCodec instances)
  if (schema instanceof z.ZodCodec) {
    const wireSchema = (schema as any).def?.in
    // Use Zod's encode to convert runtime → wire format
    const wireValue = z.encode(schema, value)
    // Then convert wire format to Convex-safe JSON
    return wireSchema ? schemaToConvex(wireValue, wireSchema) : basicToConvex(wireValue)
  }

  // Handle wrapper types
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    // Use unwrap() method which is available on these types
    const inner = schema.unwrap()
    return schemaToConvex(value, asZodType(inner))
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
// NOTE: This is an internal function. Use schema.parse() for decoding instead.
function fromConvexJS(value: any, schema: any): any {
  if (value === undefined || value === null) return value

  // Check for native ZodCodec first (including zodvexCodec instances)
  if (schema instanceof z.ZodCodec) {
    const wireSchema = (schema as any).def?.in
    // First convert Convex JSON to wire format
    const wireValue = wireSchema ? fromConvexJS(value, wireSchema) : value
    // Then use Zod's parse to decode wire → runtime format
    return schema.parse(wireValue)
  }

  // Handle wrapper types
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    // Use unwrap() method which is available on these types
    const inner = schema.unwrap()
    return fromConvexJS(value, asZodType(inner))
  }

  // Handle Date specifically (note: z.date() will be caught by assertNoNativeZodDate)
  if (schema instanceof z.ZodDate && typeof value === 'number') {
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
  // Note: ZodPipe doesn't exist in Zod v4, only ZodTransform
  if (schema instanceof z.ZodTransform) {
    // Cannot access inner schema without _def, return value as-is
    return value
  }

  return value
}

/**
 * Creates a branded ZodCodec for use with zodvex type inference.
 * Thin wrapper around z.codec() that adds type branding, allowing
 * ConvexValidatorFromZod to extract the wire schema even when the
 * codec is wrapped in a custom type alias.
 *
 * @example
 * ```typescript
 * type MyCodec = ZodvexCodec<z.ZodObject<{ ts: z.ZodNumber }>, z.ZodCustom<Date>>
 *
 * function myCodec(): MyCodec {
 *   return zodvexCodec(
 *     z.object({ ts: z.number() }),
 *     z.custom<Date>(() => true),
 *     {
 *       decode: (wire) => new Date(wire.ts),
 *       encode: (date) => ({ ts: date.getTime() })
 *     }
 *   )
 * }
 * ```
 */
export function zodvexCodec<W extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.input<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R> {
  // Cast transforms to satisfy Zod's internal MaybeAsync typing while keeping our API simple
  return z.codec(wire, runtime, transforms as Parameters<typeof z.codec<W, R>>[2]) as ZodvexCodec<
    W,
    R
  >
}
