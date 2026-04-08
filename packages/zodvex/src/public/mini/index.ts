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

export {
  type BoundaryHelpers,
  type BoundaryHelpersOptions,
  createBoundaryHelpers,
  ZodvexDecodeError
} from '../../internal/boundaryHelpers'
export { type Zid, zid } from '../../internal/ids'
export {
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  getObjectShape,
  type ZodValidator,
  zodToConvex,
  zodToConvexFields
} from '../../internal/mapping'
export { normalizeCodecPaths, safeEncode } from '../../internal/normalizeCodecPaths'
// Re-export registry
export * from '../../internal/registry'
// Re-export results
export * from '../../internal/results'
// Re-export schema types
export type { ZodTableMap, ZodTableSchemas } from '../../internal/schema'
export { mapDateFieldToNumber } from '../../internal/schema/dateGuards'
export { pickShape, safeOmit, safePick } from '../../internal/schema/pick'
export { returnsAs, zPaginated } from '../../internal/schema/runtimeHelpers'
export { stripUndefined } from '../../internal/stripUndefined'
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
} from '../../internal/types'
export { extractCodec, readFnArgs, readFnReturns } from '../codegen/extractCodec'
export { type FullZodModelSchemas, type UnionModelSchemas } from '../model'
export {
  type ConvexCodec,
  convexCodec,
  decodeDoc,
  encodeDoc,
  encodePartialDoc,
  type ZodvexCodec,
  zodvexCodec
} from './codec'
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
