/**
 * zodvex/labs — experimental utilities. APIs may change between releases.
 *
 * zod-to-mini codemod: one-time migration from full zod to zod/mini syntax.
 * Requires ts-morph as a devDependency: `bun add -D ts-morph`
 *
 * @example
 * ```typescript
 * import { transformCode, zodToMiniPlugin } from 'zodvex/labs'
 *
 * // One-time codemod (programmatic)
 * const result = transformCode(sourceCode)
 *
 * // Vite plugin for dual test suites
 * // plugins: [zodToMiniPlugin({ tsconfig: './tsconfig.json' })]
 * ```
 */

export type { TransformResult, ZodToMiniPluginOptions } from 'zod-to-mini'
export {
  findObjectOnlyMethods,
  transformClassRefs,
  transformCode,
  transformFile,
  transformImports,
  zodToMiniPlugin
} from 'zod-to-mini'
