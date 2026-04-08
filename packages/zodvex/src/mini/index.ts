/**
 * zodvex/mini - Client-safe validators typed for zod-mini compatibility
 *
 * Re-exports the standard client-safe surface from `zodvex`, but overrides the
 * public helper types with concrete `zod/mini` schema types instead of the
 * full-zod surface. This means return types don't have instance chaining like
 * `.optional()` / `.nullable()` — use `z.optional(zx.id(...))` instead.
 *
 * Use this entrypoint when your project uses `zod/mini`.
 * Use `zodvex` when your project uses full `zod`.
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
  ZodvexDecodeError,
  zid,
  zodToConvex,
  zodToConvexFields,
  zPaginated
} from '../core'
export { type FullZodModelSchemas, type UnionModelSchemas } from '../public/model'
// Re-export registry
export * from '../registry'
// Re-export results
export * from '../results'
// Re-export schema types
export type { ZodTableMap, ZodTableSchemas } from '../schema'
// Re-export shared types
export {
  type AnyRegistry,
  type ExtractCtx,
  type ExtractVisibility,
  type InferArgs,
  type InferHandlerReturns,
  type InferReturns,
  type Overwrite,
  type PreserveReturnType,
  type ZodToConvexArgs,
  ZodvexWireSchema
} from '../types'
export { type ZodvexCodec, zodvexCodec } from './codec'
// Re-export model types (ZodModel generic works for both full/mini via Schemas param)
export {
  defineZodModel,
  type FieldPaths,
  type MiniModelSchemas,
  type MiniUnionModelSchemas,
  type ModelFieldPaths,
  type ModelSchemas,
  type SearchIndexConfig,
  type VectorIndexConfig,
  type ZodModel
} from './model'
export { type ZxMiniDate, type ZxMiniId, zx } from './zx'
