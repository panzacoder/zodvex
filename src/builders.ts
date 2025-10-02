import { z } from 'zod'
import type { ExtractCtx, InferHandlerReturns, ZodToConvexArgs } from './types'
import { zAction, zMutation, zQuery } from './wrappers'

/**
 * Creates a reusable query builder from a Convex query builder.
 * The returned builder can be called multiple times to create type-safe queries.
 *
 * @example
 * ```ts
 * import { query } from './_generated/server'
 * import { createQueryBuilder } from 'zodvex'
 *
 * // Create a reusable builder
 * export const zq = createQueryBuilder(query)
 *
 * // Use it to create queries
 * export const getUser = zq({ id: z.string() }, async (ctx, { id }) => {
 *   return ctx.db.get(id)
 * })
 * ```
 */
export function createQueryBuilder<Builder extends (fn: any) => any>(builder: Builder) {
  return <A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>, R extends z.ZodTypeAny | undefined = undefined>(
    input: A,
    handler: (
      ctx: ExtractCtx<Builder>,
      args: ZodToConvexArgs<A>
    ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
    options?: { returns?: R }
  ): ReturnType<Builder> => {
    return zQuery(builder, input, handler, options)
  }
}

/**
 * Creates a reusable mutation builder from a Convex mutation builder.
 * The returned builder can be called multiple times to create type-safe mutations.
 *
 * @example
 * ```ts
 * import { mutation } from './_generated/server'
 * import { createMutationBuilder } from 'zodvex'
 *
 * // Create a reusable builder
 * export const zm = createMutationBuilder(mutation)
 *
 * // Use it to create mutations
 * export const updateUser = zm(
 *   { id: z.string(), name: z.string() },
 *   async (ctx, { id, name }) => {
 *     return ctx.db.patch(id, { name })
 *   }
 * )
 * ```
 */
export function createMutationBuilder<Builder extends (fn: any) => any>(builder: Builder) {
  return <A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>, R extends z.ZodTypeAny | undefined = undefined>(
    input: A,
    handler: (
      ctx: ExtractCtx<Builder>,
      args: ZodToConvexArgs<A>
    ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
    options?: { returns?: R }
  ): ReturnType<Builder> => {
    return zMutation(builder, input, handler, options)
  }
}

/**
 * Creates a reusable action builder from a Convex action builder.
 * The returned builder can be called multiple times to create type-safe actions.
 *
 * @example
 * ```ts
 * import { action } from './_generated/server'
 * import { createActionBuilder } from 'zodvex'
 *
 * // Create a reusable builder
 * export const za = createActionBuilder(action)
 *
 * // Use it to create actions
 * export const sendEmail = za(
 *   { to: z.string().email(), subject: z.string() },
 *   async (ctx, { to, subject }) => {
 *     // Send email
 *   }
 * )
 * ```
 */
export function createActionBuilder<Builder extends (fn: any) => any>(builder: Builder) {
  return <A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>, R extends z.ZodTypeAny | undefined = undefined>(
    input: A,
    handler: (
      ctx: ExtractCtx<Builder>,
      args: ZodToConvexArgs<A>
    ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
    options?: { returns?: R }
  ): ReturnType<Builder> => {
    return zAction(builder, input, handler, options)
  }
}
