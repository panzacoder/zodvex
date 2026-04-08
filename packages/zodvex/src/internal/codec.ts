import { z } from 'zod'
import { zodToConvex } from './mapping'
import { type ZodvexCodec } from './types'
import { assertNoNativeZodDate, stripUndefined } from './utils'
import {
  $ZodObject,
  $ZodOptional,
  $ZodType,
  encode,
  parse,
  type infer as zinfer,
  type input as zinput,
  type output as zoutput
} from './zod-core'

// Re-export ZodvexCodec type for convenience
export { type ZodvexCodec } from './types'

/** @deprecated Use `initZodvex` or `decodeDoc`/`encodeDoc` instead. Will be removed in a future release. */
export type ConvexCodec<T> = {
  validator: any
  encode: (value: T) => any
  decode: (value: any) => T
  pick: <K extends keyof T>(keys: K[]) => ConvexCodec<Pick<T, K>>
}

/** @deprecated Use `initZodvex` or `decodeDoc`/`encodeDoc` instead. Will be removed in a future release. */
export function convexCodec<T>(schema: $ZodType<T>): ConvexCodec<T> {
  // Fail fast if z.date() is used - it won't encode correctly
  // Use zx.date() instead for Date ↔ timestamp conversion
  assertNoNativeZodDate(schema as $ZodType, 'schema')

  const validator = zodToConvex(schema)

  return {
    validator,
    // Strip undefined to ensure Convex-safe output (Convex rejects explicit undefined)
    encode: (value: T) => stripUndefined(encode(schema, value)),
    decode: (value: any) => parse(schema, value),
    pick: <K extends keyof T>(keys: K[] | Record<K, true>) => {
      if (!(schema instanceof $ZodObject)) {
        throw new Error('pick() can only be called on object schemas')
      }
      // Handle both array and object formats
      // Use manual shape extraction instead of .pick() — not available on zod/mini
      const pickKeys = Array.isArray(keys) ? keys : (Object.keys(keys) as K[])
      const shape = (schema as any)._zod.def.shape
      const pickedShape: Record<string, any> = {}
      for (const k of pickKeys) {
        if (k in shape) pickedShape[k as string] = shape[k as string]
      }
      const pickedSchema = z.object(pickedShape)
      return convexCodec(pickedSchema) as ConvexCodec<Pick<T, K>>
    }
  }
}

/**
 * Decodes a wire-format document (from Convex DB) to runtime types.
 * Runs Zod codec decode transforms (e.g., timestamp → Date via zx.date()).
 */
export function decodeDoc<S extends $ZodType>(schema: S, wireDoc: unknown): zoutput<S> {
  return parse(schema, wireDoc)
}

/**
 * Encodes a runtime document to wire format (for Convex DB writes).
 * Runs Zod codec encode transforms and strips undefined values.
 */
export function encodeDoc<S extends $ZodType>(schema: S, runtimeDoc: zoutput<S>): zinput<S> {
  return stripUndefined(encode(schema, runtimeDoc))
}

/**
 * Encodes a partial runtime document to wire format (for Convex DB patch operations).
 * Only encodes the fields present in the partial. Uses schema.partial() + z.encode().
 */
export function encodePartialDoc<S extends $ZodType>(
  schema: S,
  partial: Partial<zoutput<S>>
): Partial<zinput<S>> {
  if (!(schema instanceof $ZodObject)) {
    // For non-object schemas (unions, etc.), fall back to full encode
    // Cast needed: Partial<output<S>> is structurally compatible but not assignable to output<S>
    return stripUndefined(encode(schema, partial as zoutput<S>)) as Partial<zinput<S>>
  }
  // Use manual shape wrapping instead of .partial() — not available on zod/mini
  const shape = (schema as any)._zod.def.shape
  const partialShape: Record<string, any> = {}
  for (const [key, value] of Object.entries(shape)) {
    partialShape[key] =
      value instanceof $ZodOptional
        ? value
        : new $ZodOptional({ type: 'optional', innerType: value as any })
  }
  const partialSchema = z.object(partialShape)
  return stripUndefined(encode(partialSchema, partial)) as Partial<zinput<S>>
}

/**
 * Creates a branded ZodCodec for use with zodvex type inference.
 * Thin wrapper around z.codec() that adds type branding, allowing
 * ConvexValidatorFromZod to extract the wire schema even when the
 * codec is wrapped in a custom type alias.
 *
 * @example
 * ```typescript
 * type MyCodec = ZodvexCodec<z.ZodObject<{ ts: z.ZodNumber }>, z.ZodCustom<Date>> // zod-ok
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
export function zodvexCodec<
  W extends $ZodType,
  R extends $ZodType,
  WO = zoutput<W>,
  RI = zoutput<R>
>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: WO) => RI
    encode: (runtime: RI) => WO
  }
): ZodvexCodec<W, R> {
  // Cast transforms to satisfy Zod's internal MaybeAsync typing while keeping our API simple
  return z.codec(wire as any, runtime as any, transforms as any) as unknown as ZodvexCodec<W, R>
}
