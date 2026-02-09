/**
 * zodvex/core - Client-safe validators and utilities
 *
 * This module contains no server imports and is safe to use in:
 * - React components
 * - Client-side hooks
 * - Shared validation logic
 * - Any code that runs in the browser
 */

// Zod extensions for Convex
export * from '../zx'

// Codec utilities
export * from '../codec'

// ID utilities
export * from '../ids'

// Zod → Convex validator mapping
export * from '../mapping'

// Transform utilities
export * from '../transform'

// Result types
export * from '../results'

// Types (server imports are type-only and erased at compile time)
export * from '../types'

// Utilities (no server imports)
export * from '../utils'

// JSON Schema overrides and registry
export * from '../registry'
