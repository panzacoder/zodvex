/**
 * Canonical client-safe full-Zod surface.
 *
 * This module contains no server imports and is safe to use in:
 * - React components
 * - Client-side hooks
 * - Shared validation logic
 * - Any code that runs in the browser
 */

// Codegen runtime utilities (extractCodec, readFnArgs, readFnReturns)
export { extractCodec, readFnArgs, readFnReturns } from '../codegen/extractCodec'
// Codec helpers (shared encode/decode for client wrappers)
export {
  type BoundaryHelpers,
  type BoundaryHelpersOptions,
  createBoundaryHelpers,
  ZodvexDecodeError
} from '../internal/boundaryHelpers'
// ID utilities (named — hide registryHelpers)
export { type Zid, zid } from '../internal/ids'
// Zod → Convex validator mapping (named — hide makeUnion)
export {
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  getObjectShape,
  type ZodValidator,
  zodToConvex,
  zodToConvexFields
} from '../internal/mapping'
// Codec error path normalization (safeEncode, normalizeCodecPaths)
export { normalizeCodecPaths, safeEncode } from '../internal/normalizeCodecPaths'
// JSON Schema overrides and registry
export * from '../internal/registry'
// Result types
export * from '../internal/results'
// Schema types (type-only, no server runtime imports)
export type { ZodTableMap, ZodTableSchemas } from '../internal/schema'
// Types (server imports are type-only and erased at compile time)
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
} from '../internal/types'
// Utilities (named — hide internal helpers)
export {
  mapDateFieldToNumber,
  pickShape,
  returnsAs,
  safeOmit,
  safePick,
  stripUndefined,
  zPaginated
} from '../internal/utils'
// Codec utilities (named — hide internal re-exports)
export {
  type ConvexCodec,
  convexCodec,
  decodeDoc,
  encodeDoc,
  encodePartialDoc,
  type ZodvexCodec,
  zodvexCodec
} from './codec'
// Full-zod model helper surface
export * from './model'
// Full-zod zx helper surface
export * from './zx'
