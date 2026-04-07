/**
 * zodvex/mini - Client-safe validators typed for zod-mini compatibility
 *
 * Re-exports everything from zodvex/core, but overrides `zx` helpers
 * with types that use `$ZodType` from `zod/v4/core` instead of `z.ZodType`
 * from full zod. This means return types don't have `.optional()` /
 * `.nullable()` chaining — use `z.optional(zx.id(...))` instead.
 *
 * Use this entrypoint when your project uses `zod/mini`.
 * Use `zodvex/core` when your project uses full `zod`.
 */

// Re-export everything from core EXCEPT zx
export {
  // Codec helpers
  type BoundaryHelpers,
  type BoundaryHelpersOptions,
  // Codec utilities
  type ConvexCodec,
  // Mapping
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  convexCodec,
  createBoundaryHelpers,
  decodeDoc,
  encodeDoc,
  encodePartialDoc,
  // Codegen runtime utilities
  extractCodec,
  getObjectShape,
  // Utilities
  mapDateFieldToNumber,
  // Codec error path normalization
  normalizeCodecPaths,
  pickShape,
  readFnArgs,
  readFnReturns,
  returnsAs,
  safeEncode,
  safeOmit,
  safePick,
  stripUndefined,
  // ID utilities
  type Zid,
  type ZodValidator,
  type ZodvexCodec,
  ZodvexDecodeError,
  zid,
  zodToConvex,
  zodToConvexFields,
  zodvexCodec,
  zPaginated
} from '../core'

// Re-export model types (ZodModel generic works for both full/mini via Schemas param)
export {
  type FieldPaths,
  type FullZodModelSchemas,
  type ModelFieldPaths,
  type ModelSchemas,
  type SearchIndexConfig,
  type UnionModelSchemas,
  type VectorIndexConfig,
  type ZodModel
} from '../model'
// Re-export registry
export * from '../registry'
// Re-export results
export * from '../results'
// Re-export schema types
export type { ZodTableMap, ZodTableSchemas } from '../schema'
// Re-export types
export * from '../types'
export { defineZodModel, type MiniModelSchemas } from './model'
export { type ZxMiniDate, type ZxMiniId, zx } from './zx'
