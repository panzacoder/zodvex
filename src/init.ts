import type {
  ActionBuilder,
  FunctionVisibility,
  GenericDataModel,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import type { DatabaseHooks } from './db/hooks'
import { createZodDbReader, createZodDbWriter } from './db/wrapper'

type ZodTables = Record<string, { name: string; table: any; schema: { doc: any; base: any } }>

type ZodSchema = {
  tables: Record<string, any>
  zodTables: ZodTables
}

type Server<DataModel extends GenericDataModel> = {
  query: QueryBuilder<DataModel, 'public'>
  internalQuery: QueryBuilder<DataModel, 'internal'>
  mutation: MutationBuilder<DataModel, 'public'>
  internalMutation: MutationBuilder<DataModel, 'internal'>
  action: ActionBuilder<DataModel, 'public'>
  internalAction: ActionBuilder<DataModel, 'internal'>
}

type CustomCtxFn<ExtraArgs = any> = (
  ctx: any,
  extra?: ExtraArgs
) => Promise<Record<string, any>> | Record<string, any>

type CustomCtxWithArgsFn<ExtraArgs = any> = {
  args: Record<string, any>
  input: (
    ctx: any,
    args: any,
    extra?: ExtraArgs
  ) => Promise<Record<string, any>> | Record<string, any>
}

/** Action builder — context composition only, no DB wrapping or hooks. */
type ZodvexActionBuilder = {
  (config: any): any
  withContext: (customization: any) => ZodvexActionBuilder
}

/** DB-aware builder for queries and mutations — supports .withContext() and .withHooks(). */
type DbBuilder = {
  (config: any): any
  withContext: (customization: any) => DbBuilder
  withHooks: (hooks: DatabaseHooks) => DbBuilder
}

type DbWrapFn = (ctx: any, hooks: DatabaseHooks | undefined) => any

/**
 * Shared handler wrapping logic. Applies custom context and optional DB wrapping.
 *
 * Uses `any` internally — type safety is enforced by the public factory function
 * signatures, matching the convex-helpers `customFnBuilder` pattern.
 */
function buildHandler(
  baseBuilder: any,
  customCtxFn: CustomCtxFn | null | undefined,
  wrapDb: DbWrapFn | null,
  hooks: DatabaseHooks | null | undefined,
  config: any
) {
  const { args, handler, returns, ...extra } = config

  return baseBuilder({
    args,
    returns,
    handler: async (ctx: any, parsedArgs: any) => {
      let augmentedCtx = ctx

      if (customCtxFn) {
        const added = await customCtxFn(ctx, extra)
        augmentedCtx = { ...ctx, ...added }
      }

      if (wrapDb) {
        augmentedCtx = {
          ...augmentedCtx,
          db: wrapDb(augmentedCtx, hooks ?? undefined)
        }
      }

      return handler(augmentedCtx, parsedArgs)
    }
  })
}

/** Creates a codec-aware query builder with .withContext() and .withHooks(). */
function createQueryBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility
>(
  baseBuilder: QueryBuilder<DataModel, Visibility>,
  zodTables: ZodTables,
  customCtxFn?: CustomCtxFn | null,
  hooks?: DatabaseHooks | null
): DbBuilder {
  const wrapDb: DbWrapFn = (ctx, h) => createZodDbReader(ctx.db, zodTables, h, ctx)

  const builder = function (config: any) {
    return buildHandler(baseBuilder, customCtxFn, wrapDb, hooks, config)
  } as DbBuilder

  builder.withContext = (customization: any) =>
    createQueryBuilder(baseBuilder, zodTables, customization._fn ?? customization, hooks)

  builder.withHooks = (newHooks: DatabaseHooks) =>
    createQueryBuilder(baseBuilder, zodTables, customCtxFn, newHooks)

  return builder
}

/** Creates a codec-aware mutation builder with .withContext() and .withHooks(). */
function createMutationBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility
>(
  baseBuilder: MutationBuilder<DataModel, Visibility>,
  zodTables: ZodTables,
  customCtxFn?: CustomCtxFn | null,
  hooks?: DatabaseHooks | null
): DbBuilder {
  const wrapDb: DbWrapFn = (ctx, h) => createZodDbWriter(ctx.db, zodTables, h, ctx)

  const builder = function (config: any) {
    return buildHandler(baseBuilder, customCtxFn, wrapDb, hooks, config)
  } as DbBuilder

  builder.withContext = (customization: any) =>
    createMutationBuilder(baseBuilder, zodTables, customization._fn ?? customization, hooks)

  builder.withHooks = (newHooks: DatabaseHooks) =>
    createMutationBuilder(baseBuilder, zodTables, customCtxFn, newHooks)

  return builder
}

/** Creates an action builder with .withContext() only — actions have no ctx.db. */
function createActionBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility
>(
  baseBuilder: ActionBuilder<DataModel, Visibility>,
  zodTables: ZodTables,
  customCtxFn?: CustomCtxFn | null
): ZodvexActionBuilder {
  const builder = function (config: any) {
    return buildHandler(baseBuilder, customCtxFn, null, null, config)
  } as ZodvexActionBuilder

  builder.withContext = (customization: any) =>
    createActionBuilder(baseBuilder, zodTables, customization._fn ?? customization)

  return builder
}

/**
 * One-time setup that creates codec-aware builders for your Convex project.
 *
 * Each returned builder automatically wraps `ctx.db` with a codec-aware layer
 * that decodes reads (wire → runtime, e.g. timestamps → Dates) and encodes
 * writes (runtime → wire) using your zodTable schemas.
 *
 * Builders support fluent composition:
 * - `.withContext(ctx)` — add custom context (auth, permissions, etc.) — all builders
 * - `.withHooks(hooks)` — add DB-level hooks (validation, logging, etc.) — query/mutation only
 *
 * Action builders (`za`, `zia`) do not have `ctx.db` or `.withHooks()` since
 * Convex actions don't have database access.
 *
 * Note: `.withContext()` and `.withHooks()` each **replace** (not compose) any
 * previous value. Use `composeHooks()` to combine multiple hook configs before
 * passing to `.withHooks()`.
 *
 * @param schema - Schema from `defineZodSchema()` containing zodTable refs
 * @param server - Convex server functions (`query`, `mutation`, `action`, and internal variants)
 * @returns Pre-configured builders and context customization factories
 *
 * @example
 * ```ts
 * import { initZodvex, defineZodSchema, zodTable } from 'zodvex/server'
 * import * as server from './_generated/server'
 *
 * const schema = defineZodSchema({ users: Users, events: Events })
 *
 * export const { zq, zm, za, zCustomCtx } = initZodvex(schema, server)
 *
 * // Basic query — ctx.db auto-decodes
 * export const getEvent = zq({
 *   args: { id: zx.id('events') },
 *   handler: async (ctx, { id }) => ctx.db.get(id), // .startDate is a Date
 * })
 *
 * // With auth context
 * const authCtx = zCustomCtx(async (ctx) => {
 *   const user = await getUserOrThrow(ctx)
 *   return { user }
 * })
 * export const authQuery = zq.withContext(authCtx)
 *
 * // With auth context + hooks
 * export const adminQuery = zq.withContext(adminCtx).withHooks(adminHooks)
 * ```
 */
export function initZodvex<DataModel extends GenericDataModel>(
  schema: ZodSchema,
  server: Server<DataModel>
) {
  const zodTables = schema.zodTables

  const zq = createQueryBuilder(server.query, zodTables)
  const zm = createMutationBuilder(server.mutation, zodTables)
  const za = createActionBuilder(server.action, zodTables)
  const ziq = createQueryBuilder(server.internalQuery, zodTables)
  const zim = createMutationBuilder(server.internalMutation, zodTables)
  const zia = createActionBuilder(server.internalAction, zodTables)

  /**
   * Context customization factory -- parallels convex-helpers' customCtx.
   * Returns a customization object compatible with .withContext().
   */
  function zCustomCtx<ExtraArgs = any>(fn: CustomCtxFn<ExtraArgs>) {
    return { _fn: fn }
  }

  /**
   * Context customization with custom args -- parallels customCtxAndArgs.
   */
  function zCustomCtxWithArgs<ExtraArgs = any>(config: CustomCtxWithArgsFn<ExtraArgs>) {
    return { _fn: config.input, _args: config.args }
  }

  return {
    zq,
    zm,
    za,
    ziq,
    zim,
    zia,
    zCustomCtx,
    zCustomCtxWithArgs
  }
}
