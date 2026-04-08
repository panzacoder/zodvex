import { Project } from 'ts-morph'
import type { Plugin } from 'vite'
import { transformCode } from './transforms'

export interface ZodToMiniPluginOptions {
  /** Only transform files matching this pattern. Default: all .ts/.tsx/.js/.jsx files */
  include?: RegExp
  /** Skip files matching this pattern. Default: none */
  exclude?: RegExp
  /** Path to tsconfig.json for type-aware transforms. When provided, ambiguous methods
   *  (pick, extend, partial, omit, catchall) are only transformed when the receiver is
   *  confirmed to be a Zod schema via the TypeScript type checker. Without this, falls
   *  back to a syntactic heuristic (isLikelySchemaExpr). */
  tsconfig?: string
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
  let project: Project | undefined

  return {
    name: 'zod-to-mini',
    enforce: 'pre',

    buildStart() {
      if (options?.tsconfig) {
        project = new Project({
          tsConfigFilePath: options.tsconfig,
          skipAddingFilesFromTsConfig: true,
        })
      }
    },

    transform(code, id) {
      // Only process JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return

      // Apply include/exclude filters
      if (options?.include && !options.include.test(id)) return
      if (options?.exclude && options.exclude.test(id)) return

      // Only transform files that import from 'zod' (not 'zod/mini' or 'zod/v4/core').
      if (!code.includes("'zod'") && !code.includes('"zod"') && !code.includes('z.Zod')) return

      const result = transformCode(code, {
        filename: id,
        project,
      })

      if (!result.changed) return

      return { code: result.code, map: null }
    },
  }
}
