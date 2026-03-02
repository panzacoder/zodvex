/**
 * zodvex/core - Client-safe validators and utilities
 *
 * This module contains no server imports and is safe to use in:
 * - React components
 * - Client-side hooks
 * - Shared validation logic
 * - Any code that runs in the browser
 */

// Codec utilities
export * from '../codec'
// Codec helpers (shared encode/decode for client wrappers)
export { type CodecHelpersOptions, createCodecHelpers, ZodvexDecodeError } from '../codecHelpers'
// Codegen runtime utilities (extractCodec, readFnArgs, readFnReturns)
export { extractCodec, readFnArgs, readFnReturns } from '../codegen/extractCodec'
// ID utilities
export * from '../ids'
// Zod → Convex validator mapping
export * from '../mapping'
// Codegen metadata utilities
export * from '../meta'
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
// Transform utilities
export * from '../transform'
// Types (server imports are type-only and erased at compile time)
export * from '../types'
// Utilities (no server imports)
export * from '../utils'
// Zod extensions for Convex
export * from '../zx'
