/**
 * zodvex/mini/server - Server-only utilities for zod/mini consumers
 *
 * Same API as zodvex/server, but built with zod/mini via the esbuild
 * alias plugin. All internal schema construction uses zod/mini at runtime.
 *
 * Use this in Convex function files when your project uses zod/mini.
 */

// Re-export everything from the canonical public server surface.
// The build-time esbuild alias rewrites 'zod' -> 'zod/mini' in the output,
// so all z.object(), z.string() etc. calls use zod/mini at runtime.
export * from '../../server'
