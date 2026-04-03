import type { Plugin } from 'vite'
import { transformCode } from './transforms'

export interface ZodToMiniPluginOptions {
  /** Only transform files matching this pattern. Default: all .ts/.tsx/.js/.jsx files */
  include?: RegExp
  /** Skip files matching this pattern. Default: none */
  exclude?: RegExp
}

/**
 * Vite plugin that transforms full-zod method chains to zod/mini functional forms.
 *
 * Use alongside resolve.alias to rewrite import paths:
 *   resolve: { alias: [{ find: /^zod$/, replacement: 'zod/mini' }] }
 *
 * The alias handles import path rewriting. This plugin handles code transforms:
 *   .optional() → z.optional(schema)
 *   .email()    → .check(z.email())
 *   .extend()   → z.extend(schema, shape)
 *   z.ZodError  → $ZodError (+ import from zod/v4/core)
 *   etc.
 */
export function zodToMiniPlugin(options?: ZodToMiniPluginOptions): Plugin {
  return {
    name: 'zod-to-mini',
    enforce: 'pre',

    transform(code, id) {
      // Only process JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return

      // Apply include/exclude filters
      if (options?.include && !options.include.test(id)) return
      if (options?.exclude && options.exclude.test(id)) return

      // Only transform files that import from 'zod' (not 'zod/mini' or 'zod/v4/core').
      // The quoted 'zod' substring does NOT match 'zod/mini' because the closing quote
      // position differs. This correctly skips files already using mini syntax.
      // Limitation: files that use schema method chains without importing 'zod' directly
      // (e.g., only importing local model variables) won't be transformed. In practice
      // this is rare — any file constructing schemas imports z from 'zod'.
      if (!code.includes("'zod'") && !code.includes('"zod"') && !code.includes('z.Zod')) return

      const result = transformCode(code, { filename: id })

      if (!result.changed) return

      return { code: result.code, map: null }
    },
  }
}
