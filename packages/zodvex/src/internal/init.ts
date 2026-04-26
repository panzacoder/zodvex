import type {
  ActionBuilder,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import type { PropertyValidators } from 'convex/values'
import type { Customization } from 'convex-helpers/server/customFunctions'
import { NoOp } from 'convex-helpers/server/customFunctions'
import type { z } from 'zod'
import { createZodvexActionCtx } from './actionCtx'
import type { CustomBuilder } from './custom'
import { zCustomAction, zCustomMutation, zCustomQuery } from './custom'
import { createZodvexCustomization } from './customization'
import type { ZodvexDatabaseReader, ZodvexDatabaseWriter } from './db'
import type { ZodTableMap } from './schema'
import type { AnyRegistry, Overwrite } from './types'

/**
 * The context type received by query handlers when wrapDb: true.
 * Replaces ctx.db with ZodvexDatabaseReader while preserving auth, storage, etc.
 */
export type ZodvexQueryCtx<
  DM extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
> = Overwrite<GenericQueryCtx<DM>, { db: ZodvexDatabaseReader<DM, DD> }>

/**
 * The context type received by mutation handlers when wrapDb: true.
 * Replaces ctx.db with ZodvexDatabaseWriter while preserving auth, storage, etc.
 */
export type ZodvexMutationCtx<
  DM extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
> = Overwrite<GenericMutationCtx<DM>, { db: ZodvexDatabaseWriter<DM, DD> }>

/**
 * The context type received by action handlers.
 * Currently identical to GenericActionCtx (actions don't have ctx.db),
 * but exported for API symmetry and forward compatibility.
 */
export type ZodvexActionCtx<DM extends GenericDataModel> = GenericActionCtx<DM>

/**
 * Empty codec context — used when the codec layer adds nothing to ctx (e.g. actions, wrapDb:false).
 *
 * MUST be {} not Record<string, never>. Record<string, never> has keyof = string (index signature),
 * causing Overwrite<Ctx, Record<string, never>> to strip all properties via Omit<Ctx, string>.
 * The {} type has keyof = never, so Overwrite passes through correctly.
 */
// biome-ignore lint/complexity/noBannedTypes: {} is semantically correct here — see comment above
type NoCodecCtx = {}

type InternalCustomization = {
  args: Record<string, never>
  input: (ctx: any, args: any, extra?: any) => any
}

type InternalCustomFn = (builder: any, customization: any) => any

type InitServerBuilders = {
  query: QueryBuilder<any, 'public'>
  mutation: MutationBuilder<any, 'public'>
  action: ActionBuilder<any, 'public'>
  internalQuery: QueryBuilder<any, 'internal'>
  internalMutation: MutationBuilder<any, 'internal'>
  internalAction: ActionBuilder<any, 'internal'>
}

/**
 * A zodvex builder: callable CustomBuilder + .withContext() for composing
 * user customizations on top of the codec layer.
 *
 * .withContext() is NOT chainable — returns a plain CustomBuilder.
 * To compose multiple customizations, compose them before passing to .withContext().
 */
export type ZodvexBuilder<
  FuncType extends 'query' | 'mutation' | 'action',
  CodecCtx extends Record<string, any>,
  InputCtx extends Record<string, any>,
  Visibility extends FunctionVisibility
> = CustomBuilder<
  FuncType,
  Record<string, never>,
  CodecCtx,
  Record<string, never>,
  InputCtx,
  Visibility,
  Record<string, any>
> & {
  withContext: <
    CustomArgsValidator extends PropertyValidators,
    CustomCtx extends Record<string, any>,
    CustomMadeArgs extends Record<string, any>,
    ExtraArgs extends Record<string, any> = Record<string, any>
  >(
    customization: Customization<
      Overwrite<InputCtx, CodecCtx>,
      CustomArgsValidator,
      CustomCtx,
      CustomMadeArgs,
      ExtraArgs
    >
  ) => CustomBuilder<
    FuncType,
    CustomArgsValidator,
    Overwrite<CodecCtx, CustomCtx>,
    CustomMadeArgs,
    InputCtx,
    Visibility,
    ExtraArgs
  >
}

// Overload 1: wrapDb: false — no codec DB wrapping
export function initZodvex<DM extends GenericDataModel>(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options: { wrapDb: false; registry?: () => AnyRegistry | Promise<AnyRegistry> }
): {
  zq: ZodvexBuilder<'query', NoCodecCtx, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<'mutation', NoCodecCtx, GenericMutationCtx<DM>, 'public'>
  za: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', NoCodecCtx, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<'mutation', NoCodecCtx, GenericMutationCtx<DM>, 'internal'>
  zia: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'internal'>
}

// Overload 2: wrapDb: true (default) — codec DB wrapping with decoded types
// DD (DecodedDocs) is inferred from schema.__decodedDocs, carrying the decoded
// document types computed by DecodedDocFor<T> in defineZodSchema.
export function initZodvex<
  DM extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
>(
  schema: { __zodTableMap: ZodTableMap; __decodedDocs: DD },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options?: { wrapDb?: true; registry?: () => AnyRegistry | Promise<AnyRegistry> }
): {
  zq: ZodvexBuilder<'query', { db: ZodvexDatabaseReader<DM, DD> }, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<
    'mutation',
    { db: ZodvexDatabaseWriter<DM, DD> },
    GenericMutationCtx<DM>,
    'public'
  >
  za: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', { db: ZodvexDatabaseReader<DM, DD> }, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<
    'mutation',
    { db: ZodvexDatabaseWriter<DM, DD> },
    GenericMutationCtx<DM>,
    'internal'
  >
  zia: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'internal'>
}

// Implementation
export function initZodvex(
  schema: { __zodTableMap: ZodTableMap },
  server: InitServerBuilders,
  options?: { wrapDb?: boolean; registry?: () => AnyRegistry | Promise<AnyRegistry> }
) {
  const codec = createZodvexCustomization(schema.__zodTableMap)
  const noOp = createNoOpCustomization()
  const wrap = options?.wrapDb !== false

  const actionCust = createActionCustomization(options?.registry, noOp)
  const customizations = {
    query: wrap ? codec.query : noOp,
    mutation: wrap ? codec.mutation : noOp,
    action: actionCust
  }

  return createInitBuilderBundle(server, customizations)
}

function createNoOpCustomization(): InternalCustomization {
  return { args: {} as Record<string, never>, input: NoOp.input }
}

function createActionCustomization(
  registryThunk: (() => AnyRegistry | Promise<AnyRegistry>) | undefined,
  noOp: InternalCustomization
): InternalCustomization {
  if (!registryThunk) {
    return noOp
  }

  // Cache the resolved registry across action invocations. When the user wires
  // `registry: async () => (await import('./_zodvex/api.js')).zodvexRegistry`,
  // the dynamic import only fires on the first action call — subsequent calls
  // hit the cached value. This pattern keeps the heavy `_zodvex/api.js` schemas
  // out of the push-time module graph entirely.
  let cachedRegistry: AnyRegistry | undefined

  return {
    args: {} as Record<string, never>,
    input: async (ctx: any) => {
      cachedRegistry ??= await registryThunk()
      const wrapped = createZodvexActionCtx(cachedRegistry, ctx)
      return {
        ctx: { runQuery: wrapped.runQuery, runMutation: wrapped.runMutation },
        args: {}
      }
    }
  }
}

function getInitBuilderSpecs(
  server: InitServerBuilders,
  customizations: {
    query: InternalCustomization
    mutation: InternalCustomization
    action: InternalCustomization
  }
) {
  return [
    ['zq', server.query, customizations.query, zCustomQuery],
    ['zm', server.mutation, customizations.mutation, zCustomMutation],
    ['za', server.action, customizations.action, zCustomAction],
    ['ziq', server.internalQuery, customizations.query, zCustomQuery],
    ['zim', server.internalMutation, customizations.mutation, zCustomMutation],
    ['zia', server.internalAction, customizations.action, zCustomAction]
  ] as const
}

function createInitBuilderBundle(
  server: InitServerBuilders,
  customizations: {
    query: InternalCustomization
    mutation: InternalCustomization
    action: InternalCustomization
  }
) {
  const builders: Record<string, any> = {}

  for (const [key, rawBuilder, customization, customFn] of getInitBuilderSpecs(
    server,
    customizations
  )) {
    builders[key] = createZodvexBuilder(rawBuilder, customization, customFn as InternalCustomFn)
  }

  return builders
}

/**
 * Composes a codec customization with a user customization.
 * Codec input runs first (wraps ctx.db), user input runs second
 * (sees codec-wrapped ctx.db).
 *
 * Propagates onSuccess from the user's customization through the composed
 * return value so customFnBuilder can find it.
 *
 * @internal Exported for testing only -- not part of the public API.
 */
export function composeCustomizations(
  codecCust: InternalCustomization,
  userCust: { args?: any; input?: (ctx: any, args: any, extra?: any) => any }
) {
  return {
    args: userCust.args ?? {},
    input: async (ctx: any, args: any, extra?: any) => {
      // 1. Codec layer: wrap ctx.db
      const codecResult = await codecCust.input(ctx, {}, extra)
      const codecCtx = { ...ctx, ...codecResult.ctx }

      // 2. User layer: sees codec-wrapped ctx.db
      if (!userCust.input) {
        return { ctx: codecResult.ctx, args: {} }
      }
      const userResult = await userCust.input(codecCtx, args, extra)

      // 3. Merge ctx/args; pass through user's onSuccess (convex-helpers convention)
      return {
        ctx: { ...codecResult.ctx, ...(userResult.ctx ?? {}) },
        args: userResult.args ?? {},
        ...(userResult.onSuccess && { onSuccess: userResult.onSuccess })
      }
    }
  }
}

/**
 * Creates a zodvex-enhanced builder: a CustomBuilder callable with
 * a .withContext() method for composing user customizations.
 *
 * .withContext() is NOT chainable — returns a plain CustomBuilder.
 * To compose multiple customizations, compose them before passing
 * to .withContext().
 *
 * @internal Exported for testing only -- not part of the public API.
 */
export function createZodvexBuilder(
  rawBuilder: any,
  codecCust: InternalCustomization,
  customFn: (builder: any, customization: any) => any
) {
  const base: any = customFn(rawBuilder as any, codecCust as any)

  base.withContext = (userCust: any) => {
    const composed = composeCustomizations(codecCust, userCust)
    return customFn(rawBuilder as any, composed as any)
  }

  return base
}
