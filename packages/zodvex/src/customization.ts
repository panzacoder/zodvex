import { ZodvexDatabaseReader, ZodvexDatabaseWriter } from './db'
import type { ZodTableMap } from './schema'

/**
 * Creates Convex Customization objects that wrap ctx.db with codec
 * readers/writers. Returns { query, mutation } for use with
 * zCustomQuery/zCustomMutation or manual composition.
 *
 * @example
 * ```typescript
 * const codec = createZodvexCustomization(schema.__zodTableMap)
 * const authQuery = zCustomQuery(query, {
 *   args: {},
 *   input: async (ctx) => {
 *     const codecResult = await codec.query.input(ctx, {})
 *     const user = await getUserOrThrow({ ...ctx, ...codecResult.ctx })
 *     return { ctx: { ...codecResult.ctx, user }, args: {} }
 *   }
 * })
 * ```
 */
export function createZodvexCustomization(tableMap: ZodTableMap) {
  return {
    query: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => ({
        ctx: { db: new ZodvexDatabaseReader(ctx.db, tableMap) },
        args: {}
      })
    },
    mutation: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => ({
        ctx: { db: new ZodvexDatabaseWriter(ctx.db, tableMap) },
        args: {}
      })
    }
  }
}
