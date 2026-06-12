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
/**
 * Accepts either:
 *   - a synchronous ZodTableMap (today's `defineZodSchema(...).__zodTableMap`)
 *   - a thunk `() => ZodTableMap | Promise<ZodTableMap>` (codegen-emitted
 *     `_zodvex/tableMap.lazy.ts` for the schema-only-thin shape)
 *
 * The thunk is invoked once on the first query/mutation and cached. This
 * lets the schema-eval isolate skip loading zod entirely while the runtime
 * codec wrappers still get the zod schemas they need.
 */
export function createZodvexCustomization(
  tableMap: ZodTableMap | (() => ZodTableMap | Promise<ZodTableMap>)
) {
  let cached: ZodTableMap | undefined
  const resolve = async (): Promise<ZodTableMap> => {
    if (cached !== undefined) return cached
    cached = typeof tableMap === 'function' ? await tableMap() : tableMap
    return cached
  }
  return {
    query: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => {
        const tm = await resolve()
        return {
          ctx: { db: new ZodvexDatabaseReader(ctx.db, tm) },
          args: {}
        }
      }
    },
    mutation: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => {
        const tm = await resolve()
        return {
          ctx: { db: new ZodvexDatabaseWriter(ctx.db, tm) },
          args: {}
        }
      }
    }
  }
}
