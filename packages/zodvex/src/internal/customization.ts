import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'
import { ZodvexDatabaseReader, ZodvexDatabaseWriter } from './db'
import type { ZodTableMap } from './schema'

/**
 * Resolvers for the database the codec wrapper delegates to (#92).
 *
 * Each resolver receives the raw Convex ctx (untouched by zodvex) and returns
 * the db the codec reader/writer should wrap instead of `ctx.db`. This lets
 * native-shape layers — e.g. `convex-helpers/server/triggers` — sit UNDER the
 * codec layer: codec on top → triggers → real db. The trigger layer sees
 * wire-format writes, exactly what it is written against.
 *
 * ```ts
 * const triggers = new Triggers<DataModel>()
 * initZodvex(schema, server, {
 *   underlyingDb: { mutation: (ctx) => triggers.wrapDB(ctx).db }
 * })
 * ```
 */
export type ZodvexUnderlyingDb<
  QueryCtx = any,
  MutationCtx = any,
  Reader extends GenericDatabaseReader<any> = GenericDatabaseReader<any>,
  Writer extends GenericDatabaseWriter<any> = GenericDatabaseWriter<any>
> = {
  query?: (ctx: QueryCtx) => Reader
  mutation?: (ctx: MutationCtx) => Writer
}

/**
 * Creates Convex Customization objects that wrap ctx.db with codec
 * readers/writers. Returns { query, mutation } for use with
 * zCustomQuery/zCustomMutation or manual composition.
 *
 * When `options.underlyingDb` is provided, the codec wrapper delegates to the
 * resolved db instead of `ctx.db` (see {@link ZodvexUnderlyingDb}).
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
export function createZodvexCustomization(
  tableMap: ZodTableMap,
  options?: { underlyingDb?: ZodvexUnderlyingDb }
) {
  const resolveReaderDb = options?.underlyingDb?.query
  const resolveWriterDb = options?.underlyingDb?.mutation
  return {
    query: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => ({
        ctx: {
          db: new ZodvexDatabaseReader(resolveReaderDb ? resolveReaderDb(ctx) : ctx.db, tableMap)
        },
        args: {}
      })
    },
    mutation: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => ({
        ctx: {
          db: new ZodvexDatabaseWriter(resolveWriterDb ? resolveWriterDb(ctx) : ctx.db, tableMap)
        },
        args: {}
      })
    }
  }
}
