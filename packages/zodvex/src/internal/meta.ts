import type { $ZodType } from './zod-core'

const META_KEY = '__zodvexMeta'

export type ZodvexFunctionMeta = {
  type: 'function'
  zodArgs?: $ZodType
  zodReturns?: $ZodType
}

export type ZodvexModelDefinitionSource = 'shape' | 'schema'

export type ZodvexModelMeta = {
  type: 'model'
  tableName: string
  definitionSource?: ZodvexModelDefinitionSource
  schemas?: {
    doc: $ZodType
    insert: $ZodType
    update: $ZodType
    docArray: $ZodType
    paginatedDoc: $ZodType
  }
}

export type ZodvexMeta = ZodvexFunctionMeta | ZodvexModelMeta

export function attachMeta(target: object, meta: ZodvexMeta): void {
  Object.defineProperty(target, META_KEY, {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: false
  })
}

export function readMeta(target: unknown): ZodvexMeta | undefined {
  if (target == null || (typeof target !== 'object' && typeof target !== 'function')) {
    return undefined
  }
  return (target as Record<string, unknown>)[META_KEY] as ZodvexMeta | undefined
}

const CODEC_BRAND_KEY = '__zodvexCodecBrand'

/**
 * Attaches a provenance brand to a codec instance. Codegen reads this at
 * discovery time to match a function-embedded codec to its importable twin
 * by *declared* identity instead of inferring it from structure. Stored
 * non-enumerably so it never leaks into user data, and survives
 * `.optional()` / `.nullable()` wrapping (codegen unwraps to the codec).
 * See `docs/decisions/2026-06-08-codec-provenance-brands.md`.
 */
export function attachCodecBrand(target: object, brand: string): void {
  Object.defineProperty(target, CODEC_BRAND_KEY, {
    value: brand,
    enumerable: false,
    writable: false,
    configurable: false
  })
}

/** Reads a codec's provenance brand, or undefined if unbranded. */
export function readCodecBrand(target: unknown): string | undefined {
  if (target == null || typeof target !== 'object') return undefined
  const value = (target as Record<string, unknown>)[CODEC_BRAND_KEY]
  return typeof value === 'string' ? value : undefined
}
