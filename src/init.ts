import type { DatabaseHooks } from './db/hooks'
import { createZodDbReader, createZodDbWriter } from './db/wrapper'

type ZodTables = Record<string, { name: string; table: any; schema: { doc: any; base: any } }>

type ZodSchema = {
  tables: Record<string, any>
  zodTables: ZodTables
}

type Server = {
  query: any
  mutation: any
  action: any
  internalQuery: any
  internalMutation: any
  internalAction: any
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

type BuilderWithComposition = {
  (config: any): any
  withContext: (customization: any) => BuilderWithComposition
  withHooks: (hooks: DatabaseHooks) => BuilderWithComposition
}

/**
 * Creates a builder function with .withContext() and .withHooks() methods.
 */
function createComposableBuilder(
  baseBuilder: any,
  zodTables: ZodTables,
  isWriter: boolean,
  customCtxFn?: CustomCtxFn | null,
  hooks?: DatabaseHooks | null
): BuilderWithComposition {
  const builder = function (config: any) {
    const { args, handler, returns, ...extra } = config

    return baseBuilder({
      args,
      returns,
      handler: async (ctx: any, parsedArgs: any) => {
        let augmentedCtx = ctx

        // Apply custom context
        if (customCtxFn) {
          const added = await customCtxFn(ctx, extra)
          augmentedCtx = { ...ctx, ...added }
        }

        // Wrap ctx.db with codec-aware wrapper
        if (augmentedCtx.db) {
          augmentedCtx = {
            ...augmentedCtx,
            db: isWriter
              ? createZodDbWriter(augmentedCtx.db, zodTables, hooks ?? undefined, augmentedCtx)
              : createZodDbReader(augmentedCtx.db, zodTables, hooks ?? undefined, augmentedCtx)
          }
        }

        return handler(augmentedCtx, parsedArgs)
      }
    })
  } as BuilderWithComposition

  builder.withContext = (customization: any) => {
    return createComposableBuilder(
      baseBuilder,
      zodTables,
      isWriter,
      customization._fn ?? customization,
      hooks
    )
  }

  builder.withHooks = (newHooks: DatabaseHooks) => {
    return createComposableBuilder(baseBuilder, zodTables, isWriter, customCtxFn, newHooks)
  }

  return builder
}

/**
 * One-time setup that creates all pre-configured builders.
 * Accepts the schema from defineZodSchema() and the Convex server functions.
 */
export function initZodvex(schema: ZodSchema, server: Server) {
  const zodTables = schema.zodTables

  const zq = createComposableBuilder(server.query, zodTables, false)
  const zm = createComposableBuilder(server.mutation, zodTables, true)
  const za = createComposableBuilder(server.action, zodTables, false)
  const ziq = createComposableBuilder(server.internalQuery, zodTables, false)
  const zim = createComposableBuilder(server.internalMutation, zodTables, true)
  const zia = createComposableBuilder(server.internalAction, zodTables, false)

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
