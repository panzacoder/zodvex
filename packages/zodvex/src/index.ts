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

export * from './public'

const legacyMigrationGuide = 'docs/migration/v0.6.md'

function deprecatedRootExport(name: string): never {
  throw new Error(
    `[zodvex] \`${name}\` is deprecated and is no longer exported from \`zodvex\`.\n` +
      `Import it from \`zodvex/legacy\` temporarily, or migrate away from the legacy API.\n` +
      `Migration guide: ${legacyMigrationGuide}`
  )
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `defineZodModel` + `defineZodSchema`.
 */
export function zodTable(): never {
  return deprecatedRootExport('zodTable')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `defineZodModel`.
 */
export function zodDoc(): never {
  return deprecatedRootExport('zodDoc')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `defineZodModel`.
 */
export function zodDocOrNull(): never {
  return deprecatedRootExport('zodDocOrNull')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `initZodvex()`.
 */
export function zQueryBuilder(): never {
  return deprecatedRootExport('zQueryBuilder')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `initZodvex()`.
 */
export function zMutationBuilder(): never {
  return deprecatedRootExport('zMutationBuilder')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `initZodvex()`.
 */
export function zActionBuilder(): never {
  return deprecatedRootExport('zActionBuilder')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `initZodvex().zq.withContext()`.
 */
export function zCustomQueryBuilder(): never {
  return deprecatedRootExport('zCustomQueryBuilder')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `initZodvex().zm.withContext()`.
 */
export function zCustomMutationBuilder(): never {
  return deprecatedRootExport('zCustomMutationBuilder')
}

/**
 * @deprecated Import from `zodvex/legacy` temporarily, or migrate to `initZodvex().za.withContext()`.
 */
export function zCustomActionBuilder(): never {
  return deprecatedRootExport('zCustomActionBuilder')
}
