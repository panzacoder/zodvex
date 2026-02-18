import type {
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'
import type { PropertyValidators } from 'convex/values'
import type { Customization } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import { type CustomBuilder, customFnBuilder } from './custom'
import type {
  ExtractCtx,
  ExtractVisibility,
  InferHandlerReturns,
  InferReturns,
  ZodToConvexArgs
} from './types'
import { zAction, zMutation, zQuery } from './wrappers'

/**
 * Creates a reusable query builder from a Convex query builder.
 * Returns a builder function that accepts Convex-style config objects with args, handler, and returns.
 *
 * @example
 * ```ts
 * import { query } from './_generated/server'
 * import { zQueryBuilder } from 'zodvex'
 *
 * // Create a reusable builder
 * export const zq = zQueryBuilder(query)
 *
 * // Use it with Convex-style object syntax
 * export const getUser = zq({
 *   args: { id: z.string() },
 *   handler: async (ctx, { id }) => {
 *     return ctx.db.get(id)
 *   }
 * })
 * ```
 */
export function zQueryBuilder<Builder extends (fn: any) => any>(builder: Builder) {
  return <
    A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
    R extends z.ZodTypeAny | undefined = undefined,
    Visibility extends FunctionVisibility = ExtractVisibility<Builder>
  >(config: {
    args?: A
    handler: (
      ctx: ExtractCtx<Builder>,
      args: ZodToConvexArgs<A extends undefined ? Record<string, never> : A>
    ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>
    returns?: R
  }): RegisteredQuery<
    Visibility,
    ZodToConvexArgs<A extends undefined ? Record<string, never> : A>,
    Promise<InferReturns<R>>
  > => {
    return zQuery(builder, config.args ?? ({} as any), config.handler, {
      returns: config.returns
    }) as any
  }
}

/**
 * Creates a reusable mutation builder from a Convex mutation builder.
 * Returns a builder function that accepts Convex-style config objects with args, handler, and returns.
 *
 * @example
 * ```ts
 * import { mutation } from './_generated/server'
 * import { zMutationBuilder } from 'zodvex'
 *
 * // Create a reusable builder
 * export const zm = zMutationBuilder(mutation)
 *
 * // Use it with Convex-style object syntax
 * export const updateUser = zm({
 *   args: { id: z.string(), name: z.string() },
 *   handler: async (ctx, { id, name }) => {
 *     return ctx.db.patch(id, { name })
 *   }
 * })
 * ```
 */
export function zMutationBuilder<Builder extends (fn: any) => any>(builder: Builder) {
  return <
    A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
    R extends z.ZodTypeAny | undefined = undefined,
    Visibility extends FunctionVisibility = ExtractVisibility<Builder>
  >(config: {
    args?: A
    handler: (
      ctx: ExtractCtx<Builder>,
      args: ZodToConvexArgs<A extends undefined ? Record<string, never> : A>
    ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>
    returns?: R
  }): RegisteredMutation<
    Visibility,
    ZodToConvexArgs<A extends undefined ? Record<string, never> : A>,
    Promise<InferReturns<R>>
  > => {
    return zMutation(builder, config.args ?? ({} as any), config.handler, {
      returns: config.returns
    }) as any
  }
}

/**
 * Creates a reusable action builder from a Convex action builder.
 * Returns a builder function that accepts Convex-style config objects with args, handler, and returns.
 *
 * @example
 * ```ts
 * import { action } from './_generated/server'
 * import { zActionBuilder } from 'zodvex'
 *
 * // Create a reusable builder
 * export const za = zActionBuilder(action)
 *
 * // Use it with Convex-style object syntax
 * export const sendEmail = za({
 *   args: { to: z.string().email(), subject: z.string() },
 *   handler: async (ctx, { to, subject }) => {
 *     // Send email
 *   }
 * })
 * ```
 */
export function zActionBuilder<Builder extends (fn: any) => any>(builder: Builder) {
  return <
    A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
    R extends z.ZodTypeAny | undefined = undefined,
    Visibility extends FunctionVisibility = ExtractVisibility<Builder>
  >(config: {
    args?: A
    handler: (
      ctx: ExtractCtx<Builder>,
      args: ZodToConvexArgs<A extends undefined ? Record<string, never> : A>
    ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>
    returns?: R
  }): RegisteredAction<
    Visibility,
    ZodToConvexArgs<A extends undefined ? Record<string, never> : A>,
    Promise<InferReturns<R>>
  > => {
    return zAction(builder, config.args ?? ({} as any), config.handler, {
      returns: config.returns
    }) as any
  }
}

/**
 * @deprecated Use `zCustomQuery` from 'zodvex/server' instead. This is an identical function with a different name.
 */
export function zCustomQueryBuilder<
  Builder extends (fn: any) => any,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  query: Builder,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
): CustomBuilder<
  'query',
  CustomArgsValidator,
  CustomCtx,
  CustomMadeArgs,
  ExtractCtx<Builder>,
  Visibility,
  ExtraArgs
> {
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    query as any,
    customization as any
  ) as any
}

/**
 * @deprecated Use `zCustomMutation` from 'zodvex/server' instead. This is an identical function with a different name.
 */
export function zCustomMutationBuilder<
  Builder extends (fn: any) => any,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  mutation: Builder,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
): CustomBuilder<
  'mutation',
  CustomArgsValidator,
  CustomCtx,
  CustomMadeArgs,
  ExtractCtx<Builder>,
  Visibility,
  ExtraArgs
> {
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    mutation as any,
    customization as any
  ) as any
}

/**
 * @deprecated Use `zCustomAction` from 'zodvex/server' instead. This is an identical function with a different name.
 */
export function zCustomActionBuilder<
  Builder extends (fn: any) => any,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  action: Builder,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
): CustomBuilder<
  'action',
  CustomArgsValidator,
  CustomCtx,
  CustomMadeArgs,
  ExtractCtx<Builder>,
  Visibility,
  ExtraArgs
> {
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    action as any,
    customization as any
  ) as any
}
