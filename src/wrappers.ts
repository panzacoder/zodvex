import { z } from 'zod'
import { zodToConvex, zodToConvexFields, getObjectShape } from './mapping'
import { toConvexJS } from './codec'
import { type InferArgs, type InferReturns, type ExtractCtx, type PreserveReturnType, type ZodToConvexArgs } from './types'

export function zQuery<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  query: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: InferArgs<A>) => Promise<InferReturns<R>> | InferReturns<R>,
  options?: { returns?: R }
): PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input
    args = zodToConvexFields(getObjectShape(input))
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as z.ZodTypeAny })
    args = { value: zodToConvex(input as z.ZodTypeAny) }
  } else {
    zodSchema = z.object(input as Record<string, z.ZodTypeAny>)
    args = zodToConvexFields(input as Record<string, z.ZodTypeAny>)
  }
  const returns = options?.returns ? zodToConvex(options.returns) : undefined

  return query({
    args,
    returns,
    handler: async (ctx: ExtractCtx<Builder>, argsObject: unknown) => {
      const parsed = zodSchema.parse(argsObject) as InferArgs<A>
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        const validated = (options.returns as z.ZodTypeAny).parse(raw)
        return toConvexJS(options.returns as z.ZodTypeAny, validated)
      }
      return raw as any
    }
  }) as PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>>
}

export function zInternalQuery<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalQuery: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: InferArgs<A>) => Promise<InferReturns<R>> | InferReturns<R>,
  options?: { returns?: R }
): PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>> {
  return zQuery(internalQuery, input, handler, options)
}

export function zMutation<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  mutation: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: InferArgs<A>) => Promise<InferReturns<R>> | InferReturns<R>,
  options?: { returns?: R }
): PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input
    args = zodToConvexFields(getObjectShape(input))
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as z.ZodTypeAny })
    args = { value: zodToConvex(input as z.ZodTypeAny) }
  } else {
    zodSchema = z.object(input as Record<string, z.ZodTypeAny>)
    args = zodToConvexFields(input as Record<string, z.ZodTypeAny>)
  }
  const returns = options?.returns ? zodToConvex(options.returns) : undefined

  return mutation({
    args,
    returns,
    handler: async (ctx: ExtractCtx<Builder>, argsObject: unknown) => {
      const parsed = zodSchema.parse(argsObject) as InferArgs<A>
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        const validated = (options.returns as z.ZodTypeAny).parse(raw)
        return toConvexJS(options.returns as z.ZodTypeAny, validated)
      }
      return raw as any
    }
  }) as PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>>
}

export function zInternalMutation<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalMutation: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: InferArgs<A>) => Promise<InferReturns<R>> | InferReturns<R>,
  options?: { returns?: R }
): PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>> {
  return zMutation(internalMutation, input, handler, options)
}

export function zAction<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  action: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: InferArgs<A>) => Promise<InferReturns<R>> | InferReturns<R>,
  options?: { returns?: R }
): PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input
    args = zodToConvexFields(getObjectShape(input))
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as z.ZodTypeAny })
    args = { value: zodToConvex(input as z.ZodTypeAny) }
  } else {
    zodSchema = z.object(input as Record<string, z.ZodTypeAny>)
    args = zodToConvexFields(input as Record<string, z.ZodTypeAny>)
  }
  const returns = options?.returns ? zodToConvex(options.returns) : undefined

  return action({
    args,
    returns,
    handler: async (ctx: ExtractCtx<Builder>, argsObject: unknown) => {
      const parsed = zodSchema.parse(argsObject) as InferArgs<A>
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        const validated = (options.returns as z.ZodTypeAny).parse(raw)
        return toConvexJS(options.returns as z.ZodTypeAny, validated)
      }
      return raw as any
    }
  }) as PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>>
}

export function zInternalAction<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalAction: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: InferArgs<A>) => Promise<InferReturns<R>> | InferReturns<R>,
  options?: { returns?: R }
): PreserveReturnType<Builder, ZodToConvexArgs<A>, InferReturns<R>> {
  return zAction(internalAction, input, handler, options)
}

