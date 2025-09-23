import { z } from 'zod'
import { ConvexError } from 'convex/values'
import { toConvexJS, fromConvexJS } from './codec'
import { zodToConvex, zodToConvexFields } from './mapping'
// Typing helpers to keep handler args/returns precise without deep remapping
import type { InferHandlerReturns, ZodToConvexArgs, ExtractCtx } from './types'
import { formatZodIssues } from './utils'
import type { RegisteredQuery, RegisteredMutation, RegisteredAction } from 'convex/server'

export function zQuery<
  Builder extends (fn: any) => RegisteredQuery<any, any, any>,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  query: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): ReturnType<Builder> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input as any
    args = zodToConvexFields(input as any)
  } else if (input instanceof z.ZodType) {
    // Single schema → normalize to { value }
    zodSchema = z.object({ value: input as any })
    args = { value: zodToConvex(input as any) }
  } else {
    zodSchema = z.object(input as Record<string, any>)
    args = zodToConvexFields(input as Record<string, any>)
  }
  const returns = options?.returns ? zodToConvex(options.returns) : undefined

  return query({
    args,
    returns,
    handler: async (ctx: ExtractCtx<Builder>, argsObject: unknown) => {
      const decoded = fromConvexJS(argsObject, zodSchema)
      let parsed: any
      try {
        parsed = zodSchema.parse(decoded) as any
      } catch (e) {
        if (e instanceof z.ZodError) {
          throw new ConvexError(formatZodIssues(e, 'args'))
        }
        throw e
      }
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        try {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        } catch (e) {
          if (e instanceof z.ZodError) {
            throw new ConvexError(formatZodIssues(e, 'returns'))
          }
          throw e
        }
      }
      // Fallback: ensure Convex-safe return values (e.g., Date → timestamp)
      return toConvexJS(raw) as any
    }
  }) as unknown as ReturnType<Builder>
}

export function zInternalQuery<
  Builder extends (fn: any) => RegisteredQuery<any, any, any>,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalQuery: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): ReturnType<Builder> {
  return zQuery(internalQuery, input, handler, options)
}

export function zMutation<
  Builder extends (fn: any) => RegisteredMutation<any, any, any>,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  mutation: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): ReturnType<Builder> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input as any
    args = zodToConvexFields(input as any)
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as any })
    args = { value: zodToConvex(input as any) }
  } else {
    zodSchema = z.object(input as Record<string, any>)
    args = zodToConvexFields(input as Record<string, any>)
  }
  const returns = options?.returns ? zodToConvex(options.returns) : undefined

  return mutation({
    args,
    returns,
    handler: async (ctx: ExtractCtx<Builder>, argsObject: unknown) => {
      const decoded = fromConvexJS(argsObject, zodSchema)
      let parsed: any
      try {
        parsed = zodSchema.parse(decoded) as any
      } catch (e) {
        if (e instanceof z.ZodError) {
          throw new ConvexError(formatZodIssues(e, 'args'))
        }
        throw e
      }
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        try {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        } catch (e) {
          if (e instanceof z.ZodError) {
            throw new ConvexError(formatZodIssues(e, 'returns'))
          }
          throw e
        }
      }
      // Fallback: ensure Convex-safe return values (e.g., Date → timestamp)
      return toConvexJS(raw) as any
    }
  }) as unknown as ReturnType<Builder>
}

export function zInternalMutation<
  Builder extends (fn: any) => RegisteredMutation<any, any, any>,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalMutation: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): ReturnType<Builder> {
  return zMutation(internalMutation, input, handler, options)
}

export function zAction<
  Builder extends (fn: any) => RegisteredAction<any, any, any>,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  action: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): ReturnType<Builder> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input as any
    args = zodToConvexFields(input as any)
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as any })
    args = { value: zodToConvex(input as any) }
  } else {
    zodSchema = z.object(input as Record<string, any>)
    args = zodToConvexFields(input as Record<string, any>)
  }
  const returns = options?.returns ? zodToConvex(options.returns) : undefined

  return action({
    args,
    returns,
    handler: async (ctx: ExtractCtx<Builder>, argsObject: unknown) => {
      const decoded = fromConvexJS(argsObject, zodSchema)
      let parsed: any
      try {
        parsed = zodSchema.parse(decoded) as any
      } catch (e) {
        if (e instanceof z.ZodError) {
          throw new ConvexError(formatZodIssues(e, 'args'))
        }
        throw e
      }
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        try {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        } catch (e) {
          if (e instanceof z.ZodError) {
            throw new ConvexError(formatZodIssues(e, 'returns'))
          }
          throw e
        }
      }
      // Fallback: ensure Convex-safe return values (e.g., Date → timestamp)
      return toConvexJS(raw) as any
    }
  }) as unknown as ReturnType<Builder>
}

export function zInternalAction<
  Builder extends (fn: any) => RegisteredAction<any, any, any>,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalAction: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): ReturnType<Builder> {
  return zAction(internalAction, input, handler, options)
}
