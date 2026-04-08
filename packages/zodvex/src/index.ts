/**
 * zodvex - Client-safe full-Zod surface.
 *
 * This is the canonical entrypoint for standard full-Zod consumers.
 * Server-only APIs live under `zodvex/server`.
 *
 * @example
 * ```ts
 * import { zx, defineZodModel } from 'zodvex'
 * import { defineZodSchema, initZodvex } from 'zodvex/server'
 * ```
 */

export * from './full'
