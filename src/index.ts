/**
 * zodvex - Full library (backwards compatible)
 *
 * Re-exports everything from both core and server modules.
 * For optimal bundle size in client code, import from 'zodvex/core' instead.
 *
 * @example
 * // Full import (pulls in server code)
 * import { zx, zodTable } from 'zodvex'
 *
 * // Optimized client import (no server code)
 * import { zx } from 'zodvex/core'
 *
 * // Server-only import
 * import { zodTable } from 'zodvex/server'
 */

export * from './core'
export * from './server'
