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
// Schema types (type-only, no server runtime imports)
export type { ZodTableMap } from '../schema'
// ID utilities
export * from '../ids'
// Zod → Convex validator mapping
export * from '../mapping'
// JSON Schema overrides and registry
export * from '../registry'
// Result types
export * from '../results'
// Transform utilities
export * from '../transform'

// Types (server imports are type-only and erased at compile time)
export * from '../types'

// Utilities (no server imports)
export * from '../utils'
// Zod extensions for Convex
export * from '../zx'
