import { readMeta } from '../../internal/meta'
import {
  $ZodCodec,
  $ZodCustom,
  $ZodNullable,
  $ZodNumber,
  $ZodOptional,
  $ZodType
} from '../../internal/zod-core'

/**
 * Unwraps ZodOptional/ZodNullable layers to find the inner ZodCodec.
 * Returns the codec instance, or undefined if none found.
 * Skips zx.date() (ZodCodec with in=ZodNumber, out=ZodCustom).
 *
 * Used internally by the discovery pipeline to probe schemas for codecs.
 */
export function findCodec(schema: $ZodType): $ZodType | undefined {
  let current = schema
  for (let i = 0; i < 10; i++) {
    if (current instanceof $ZodCodec) {
      const isZxDate =
        current._zod.def.in instanceof $ZodNumber && current._zod.def.out instanceof $ZodCustom
      if (isZxDate) return undefined
      return current
    }
    if (current instanceof $ZodOptional || current instanceof $ZodNullable) {
      current = current._zod.def.innerType
      continue
    }
    break
  }
  return undefined
}

/**
 * Extracts the inner ZodCodec from a schema, throwing if none is found.
 * The codegen only emits extractCodec() calls for schemas it has verified
 * contain a codec during discovery, so a missing codec is a bug.
 *
 * Used by generated _zodvex/api.ts to extract codec references at runtime.
 */
export function extractCodec(schema: $ZodType): $ZodType {
  const codec = findCodec(schema)
  if (!codec) {
    throw new Error('zodvex: extractCodec() found no codec in schema — this is a codegen bug')
  }
  return codec
}

/**
 * Extracts the zodArgs schema from a zodvex-registered function.
 * Used by generated _zodvex/api.ts to access function-embedded codecs at runtime.
 */
export function readFnArgs(fn: unknown): $ZodType {
  const meta = readMeta(fn)
  if (!meta || meta.type !== 'function' || !meta.zodArgs) {
    throw new Error('zodvex: function has no zodArgs metadata')
  }
  return meta.zodArgs as $ZodType
}

/**
 * Extracts the zodReturns schema from a zodvex-registered function.
 * Used by generated _zodvex/api.ts to access function-embedded codecs at runtime.
 */
export function readFnReturns(fn: unknown): $ZodType {
  const meta = readMeta(fn)
  if (!meta || meta.type !== 'function' || !meta.zodReturns) {
    throw new Error('zodvex: function has no zodReturns metadata')
  }
  return meta.zodReturns as $ZodType
}
