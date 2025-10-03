import { z } from 'zod'
import type {
  ExtractCtx,
  ExtractVisibility,
  InferHandlerReturns,
  InferReturns,
  ZodToConvexArgs
} from './types'
import { zAction, zMutation, zQuery } from './wrappers'
import type {
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'

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
  }): RegisteredQuery<Visibility, ZodToConvexArgs<A extends undefined ? Record<string, never> : A>, Promise<InferReturns<R>>> => {
    return zQuery(builder, config.args ?? ({} as any), config.handler, { returns: config.returns }) as any
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
  }): RegisteredMutation<Visibility, ZodToConvexArgs<A extends undefined ? Record<string, never> : A>, Promise<InferReturns<R>>> => {
    return zMutation(builder, config.args ?? ({} as any), config.handler, { returns: config.returns }) as any
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
  }): RegisteredAction<Visibility, ZodToConvexArgs<A extends undefined ? Record<string, never> : A>, Promise<InferReturns<R>>> => {
    return zAction(builder, config.args ?? ({} as any), config.handler, { returns: config.returns }) as any
  }
}
