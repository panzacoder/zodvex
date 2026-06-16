import { z } from 'zod'
import { zodToConvex } from './mapping'
import { assertNoNativeZodDate } from './schema/dateGuards'
import { stripUndefined } from './stripUndefined'
import { type ZodvexCodec } from './types'
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
 * Strips `undefined` from nested values while preserving top-level `undefined` keys.
 *
 * This is the patch-specific counterpart to `stripUndefined`. On a Convex `patch`,
 * a top-level field set to `undefined` is the documented way to *delete* that field
 * (Convex serializes it to `{ $undefined: null }` via `patchValueToJson`). A blanket
 * `stripUndefined` would drop that key before Convex ever sees it, turning an intended
 * unset into a silent no-op (issue #82).
 *
 * So we keep top-level `undefined` keys intact (they reach Convex as deletes) but still
 * clean `undefined` *inside* nested values — matching how `encodeDoc` treats stored
 * values, where `undefined` means "absent" rather than "delete".
 */
function stripUndefinedPreservingTopLevel(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    // Top-level undefined = intentional field deletion — preserve it for Convex.
    result[key] = val === undefined ? undefined : stripUndefined(val)
  }
  return result
}

/**
 * Encodes a partial runtime document to wire format (for Convex DB patch operations).
 * Only encodes the fields present in the partial. Uses schema.partial() + z.encode().
 *
 * Unlike `encodeDoc`, this preserves top-level `undefined` values so that
 * `patch(id, { field: undefined })` deletes the field, matching native Convex
 * `patch` semantics (issue #82). Nested `undefined` is still stripped.
 */
export function encodePartialDoc<S extends $ZodType>(
  schema: S,
  partial: Partial<zoutput<S>>
): Partial<zinput<S>> {
  if (!(schema instanceof $ZodObject)) {
    // For non-object schemas (unions, etc.), fall back to full encode
    // Cast needed: Partial<output<S>> is structurally compatible but not assignable to output<S>
    const encoded = encode(schema, partial as zoutput<S>)
    // Top-level union docs are still objects — preserve top-level undefined for deletes.
    return (
      encoded !== null && typeof encoded === 'object' && !Array.isArray(encoded)
        ? stripUndefinedPreservingTopLevel(encoded as Record<string, unknown>)
        : stripUndefined(encoded)
    ) as Partial<zinput<S>>
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
  const encoded = encode(partialSchema, partial) as Record<string, unknown>
  return stripUndefinedPreservingTopLevel(encoded) as Partial<zinput<S>>
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
