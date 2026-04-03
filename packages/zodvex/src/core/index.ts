import { z } from 'zod'
import { setZodFactory } from '../zod-core'
setZodFactory(z)

/**
 * zodvex/core - Client-safe validators and utilities
 *
 * This module contains no server imports and is safe to use in:
 * - React components
 * - Client-side hooks
 * - Shared validation logic
 * - Any code that runs in the browser
 */

// Codec helpers (shared encode/decode for client wrappers)
export {
  type BoundaryHelpers,
  type BoundaryHelpersOptions,
  createBoundaryHelpers,
  ZodvexDecodeError
} from '../boundaryHelpers'
// Codec utilities (named — hide internal re-exports)
export {
  type ConvexCodec,
  convexCodec,
  decodeDoc,
  encodeDoc,
  encodePartialDoc,
  type ZodvexCodec,
  zodvexCodec
} from '../codec'
// Codegen runtime utilities (extractCodec, readFnArgs, readFnReturns)
export { extractCodec, readFnArgs, readFnReturns } from '../codegen/extractCodec'
// ID utilities (named — hide registryHelpers)
export { type Zid, zid } from '../ids'
// Zod → Convex validator mapping (named — hide makeUnion)
export {
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  getObjectShape,
  type ZodValidator,
  zodToConvex,
  zodToConvexFields
} from '../mapping'
// Client-safe model definitions
export * from '../model'
// Codec error path normalization (safeEncode, normalizeCodecPaths)
export { normalizeCodecPaths, safeEncode } from '../normalizeCodecPaths'
// JSON Schema overrides and registry
export * from '../registry'
// Result types
export * from '../results'
// Schema types (type-only, no server runtime imports)
export type { ZodTableMap, ZodTableSchemas } from '../schema'
// Types (server imports are type-only and erased at compile time)
export * from '../types'
// Utilities (named — hide internal helpers)
export {
  mapDateFieldToNumber,
  pickShape,
  returnsAs,
  safeOmit,
  safePick,
  stripUndefined,
  zPaginated
} from '../utils'
// Zod extensions for Convex
export * from '../zx'
