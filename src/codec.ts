import { z } from 'zod'
import { zodToConvex } from './mapping'
import { type ZodvexCodec } from './types'
import { assertNoNativeZodDate, stripUndefined } from './utils'

// Re-export ZodvexCodec type for convenience
export { type ZodvexCodec } from './types'

export type ConvexCodec<T> = {
  validator: any
  encode: (value: T) => any
  decode: (value: any) => T
  pick: <K extends keyof T>(keys: K[]) => ConvexCodec<Pick<T, K>>
}

export function convexCodec<T>(schema: z.ZodType<T>): ConvexCodec<T> {
  // Fail fast if z.date() is used - it won't encode correctly
  // Use zx.date() instead for Date ↔ timestamp conversion
  assertNoNativeZodDate(schema as z.ZodTypeAny, 'schema')

  const validator = zodToConvex(schema)

  return {
    validator,
    // Strip undefined to ensure Convex-safe output (Convex rejects explicit undefined)
    encode: (value: T) => stripUndefined(z.encode(schema, value)),
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

/**
 * Decodes a wire-format document (from Convex DB) to runtime types.
 * Runs Zod codec decode transforms (e.g., timestamp → Date via zx.date()).
 */
export function decodeDoc<S extends z.ZodTypeAny>(schema: S, wireDoc: unknown): z.output<S> {
  return schema.parse(wireDoc)
}

/**
 * Encodes a runtime document to wire format (for Convex DB writes).
 * Runs Zod codec encode transforms and strips undefined values.
 */
export function encodeDoc<S extends z.ZodTypeAny>(schema: S, runtimeDoc: z.output<S>): z.input<S> {
  return stripUndefined(z.encode(schema, runtimeDoc))
}

/**
 * Encodes a partial runtime document to wire format (for Convex DB patch operations).
 * Only encodes the fields present in the partial. Uses schema.partial() + z.encode().
 */
export function encodePartialDoc<S extends z.ZodTypeAny>(
  schema: S,
  partial: Partial<z.output<S>>
): Partial<z.input<S>> {
  if (!(schema instanceof z.ZodObject)) {
    // For non-object schemas (unions, etc.), fall back to full encode
    return stripUndefined(z.encode(schema, partial))
  }
  const partialSchema = schema.partial()
  return stripUndefined(z.encode(partialSchema, partial))
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
