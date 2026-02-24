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
import { createCodecCustomization } from './customization'
import type { CodecDatabaseReader, CodecDatabaseWriter } from './db'
import type { ZodTableMap } from './schema'
import type { AnyRegistry, Overwrite } from './types'

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
  InputCtx,
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
  options: { wrapDb: false; registry?: () => AnyRegistry }
): {
  zq: ZodvexBuilder<'query', Record<string, never>, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<'mutation', Record<string, never>, GenericMutationCtx<DM>, 'public'>
  za: ZodvexBuilder<'action', Record<string, never>, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', Record<string, never>, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<'mutation', Record<string, never>, GenericMutationCtx<DM>, 'internal'>
  zia: ZodvexBuilder<'action', Record<string, never>, GenericActionCtx<DM>, 'internal'>
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
  options?: { wrapDb?: true; registry?: () => AnyRegistry }
): {
  zq: ZodvexBuilder<'query', { db: CodecDatabaseReader<DM, DD> }, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<
    'mutation',
    { db: CodecDatabaseWriter<DM, DD> },
    GenericMutationCtx<DM>,
    'public'
  >
  za: ZodvexBuilder<'action', Record<string, never>, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', { db: CodecDatabaseReader<DM, DD> }, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<
    'mutation',
    { db: CodecDatabaseWriter<DM, DD> },
    GenericMutationCtx<DM>,
    'internal'
  >
  zia: ZodvexBuilder<'action', Record<string, never>, GenericActionCtx<DM>, 'internal'>
}

// Implementation
export function initZodvex(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query: QueryBuilder<any, 'public'>
    mutation: MutationBuilder<any, 'public'>
    action: ActionBuilder<any, 'public'>
    internalQuery: QueryBuilder<any, 'internal'>
    internalMutation: MutationBuilder<any, 'internal'>
    internalAction: ActionBuilder<any, 'internal'>
  },
  options?: { wrapDb?: boolean; registry?: () => AnyRegistry }
) {
  const codec = createCodecCustomization(schema.__zodTableMap)
  const noOp = { args: {} as Record<string, never>, input: NoOp.input }
  const wrap = options?.wrapDb !== false

  // Create action customization when registry is provided
  const registryThunk = options?.registry
  const actionCust = registryThunk
    ? {
        args: {} as Record<string, never>,
        input: async (ctx: any) => {
          const wrapped = createZodvexActionCtx(registryThunk(), ctx)
          return {
            ctx: { runQuery: wrapped.runQuery, runMutation: wrapped.runMutation },
            args: {}
          }
        }
      }
    : noOp

  return {
    zq: createZodvexBuilder(server.query, wrap ? codec.query : noOp, zCustomQuery),
    zm: createZodvexBuilder(server.mutation, wrap ? codec.mutation : noOp, zCustomMutation),
    za: createZodvexBuilder(server.action, actionCust, zCustomAction),
    ziq: createZodvexBuilder(server.internalQuery, wrap ? codec.query : noOp, zCustomQuery),
    zim: createZodvexBuilder(
      server.internalMutation,
      wrap ? codec.mutation : noOp,
      zCustomMutation
    ),
    zia: createZodvexBuilder(server.internalAction, actionCust, zCustomAction)
  }
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
export function composeCodecAndUser(
  codecCust: { args: Record<string, never>; input: (ctx: any, args: any, extra?: any) => any },
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
  codecCust: { args: Record<string, never>; input: (ctx: any, args: any, extra?: any) => any },
  customFn: (builder: any, customization: any) => any
) {
  const base: any = customFn(rawBuilder as any, codecCust as any)

  base.withContext = (userCust: any) => {
    const composed = composeCodecAndUser(codecCust, userCust)
    return customFn(rawBuilder as any, composed as any)
  }

  return base
}
