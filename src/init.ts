import type {
  ActionBuilder,
  FunctionVisibility,
  GenericDataModel,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import type { Customization } from 'convex-helpers/server/customFunctions'
import { customFnBuilder, zCustomAction, zCustomMutation, zCustomQuery } from './custom'
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

/** NoOp customization for actions (no ctx.db wrapping). */
const actionNoOp = {
  args: {},
  input: async () => ({ ctx: {}, args: {} })
}

/**
 * One-time setup that creates codec-aware builders for your Convex project.
 *
 * Each returned query/mutation builder automatically wraps `ctx.db` with a
 * codec-aware layer that decodes reads (wire -> runtime, e.g. timestamps -> Dates)
 * and encodes writes (runtime -> wire) using your zodTable schemas.
 *
 * All builders include full Zod validation: args parsing, returns encoding,
 * Zod -> Convex validator conversion, and `stripUndefined`.
 *
 * Action builders do NOT wrap ctx.db (actions have no database access in Convex).
 *
 * @param schema - Schema from `defineZodSchema()` containing zodTable refs
 * @param server - Convex server functions (`query`, `mutation`, `action`, and internal variants)
 * @returns Pre-configured builders and blessed-builder factories
 *
 * @example
 * ```ts
 * import { initZodvex, defineZodSchema, zodTable } from 'zodvex/server'
 * import { customCtx } from 'convex-helpers/server/customFunctions'
 * import * as server from './_generated/server'
 *
 * const schema = defineZodSchema({ users: Users, events: Events })
 *
 * export const {
 *   zQuery, zMutation, zAction,
 *   zCustomQuery, zCustomMutation, zCustomAction,
 * } = initZodvex(schema, server)
 *
 * // Basic query — ctx.db auto-decodes
 * export const getEvent = zQuery({
 *   args: { id: zx.id('events') },
 *   returns: Events.schema.doc.nullable(),
 *   handler: async (ctx, { id }) => ctx.db.get(id),
 * })
 *
 * // Blessed builder with auth context
 * const hotpotQuery = zCustomQuery(
 *   customCtx(async (ctx) => {
 *     const user = await getUser(ctx)
 *     const db = createSecureReader({ user }, ctx.db, securityRules)
 *     return { user, db }
 *   })
 * )
 * ```
 */
export function initZodvex<DataModel extends GenericDataModel>(
  schema: ZodSchema,
  server: Server<DataModel>
) {
  const zodTables = schema.zodTables

  // --- Codec customizations ---
  // Wraps ctx.db with codec-aware reader (queries) or writer (mutations).

  const codecQueryCustomization = {
    args: {},
    input: async (ctx: any) => ({
      ctx: { db: createZodDbReader(ctx.db, zodTables) },
      args: {}
    })
  }

  const codecMutationCustomization = {
    args: {},
    input: async (ctx: any) => ({
      ctx: { db: createZodDbWriter(ctx.db, zodTables) },
      args: {}
    })
  }

  // --- Base builders (codec-aware, Zod-validated) ---

  const zQuery = zCustomQuery(server.query, codecQueryCustomization as any)
  const zMutation = zCustomMutation(server.mutation, codecMutationCustomization as any)
  const zAction = zCustomAction(server.action, actionNoOp as any)
  const zInternalQuery = zCustomQuery(server.internalQuery, codecQueryCustomization as any)
  const zInternalMutation = zCustomMutation(
    server.internalMutation,
    codecMutationCustomization as any
  )
  const zInternalAction = zCustomAction(server.internalAction, actionNoOp as any)

  // --- Blessed builder factories ---
  // Pre-bind schema so consumers just pass their customization.
  // The consumer's customization composes ON TOP of the codec customization.
  // Their ctx.db is already codec-aware by the time their input() runs.

  function makeZCustomQuery(customization: Customization<any, any, any, any, any>) {
    const composed = {
      args: customization.args ?? {},
      input: async (ctx: any, args: any, extra: any) => {
        const codecCtx = { ...ctx, db: createZodDbReader(ctx.db, zodTables) }
        if (customization.input) {
          return customization.input(codecCtx, args, extra)
        }
        return { ctx: { db: codecCtx.db }, args: {} }
      }
    }
    return zCustomQuery(server.query, composed as any)
  }

  function makeZCustomMutation(customization: Customization<any, any, any, any, any>) {
    const composed = {
      args: customization.args ?? {},
      input: async (ctx: any, args: any, extra: any) => {
        const codecCtx = { ...ctx, db: createZodDbWriter(ctx.db, zodTables) }
        if (customization.input) {
          return customization.input(codecCtx, args, extra)
        }
        return { ctx: { db: codecCtx.db }, args: {} }
      }
    }
    return zCustomMutation(server.mutation, composed as any)
  }

  function makeZCustomAction(customization: Customization<any, any, any, any, any>) {
    return zCustomAction(server.action, customization)
  }

  return {
    zQuery,
    zMutation,
    zAction,
    zInternalQuery,
    zInternalMutation,
    zInternalAction,
    zCustomQuery: makeZCustomQuery,
    zCustomMutation: makeZCustomMutation,
    zCustomAction: makeZCustomAction
  }
}
