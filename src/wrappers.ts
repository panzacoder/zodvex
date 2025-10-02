import type {
  ActionBuilder,
  DefaultFunctionArgs,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'
import { ConvexError } from 'convex/values'
import { z } from 'zod'
import { fromConvexJS, toConvexJS } from './codec'
import { getObjectShape, zodToConvex, zodToConvexFields } from './mapping'
// Typing helpers to keep handler args/returns precise without deep remapping
import type { InferHandlerReturns, InferReturns, ZodToConvexArgs } from './types'
import { formatZodIssues } from './utils'

// Check if a schema contains z.custom types (runtime check)
function containsCustom(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodCustom) return true
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodTypeAny[]).some(containsCustom)
  }
  if (schema instanceof z.ZodOptional) {
    return containsCustom(schema.unwrap() as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodNullable) {
    return containsCustom(schema.unwrap() as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodDefault) {
    return containsCustom(schema.removeDefault() as z.ZodTypeAny)
  }
  return false
}

export function zQuery<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  query: QueryBuilder<DataModel, Visibility>,
  input: A,
  handler: (
    ctx: GenericQueryCtx<DataModel>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredQuery<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input as any
    args = zodToConvexFields(getObjectShape(input))
  } else if (input instanceof z.ZodType) {
    // Single schema → normalize to { value }
    zodSchema = z.object({ value: input as any })
    args = { value: zodToConvex(input as any) }
  } else {
    zodSchema = z.object(input as Record<string, any>)
    args = zodToConvexFields(input as Record<string, any>)
  }
  // Skip returns validator for schemas with custom types to avoid type depth issues
  const returns =
    options?.returns && !containsCustom(options.returns) ? zodToConvex(options.returns) : undefined

  return query({
    args,
    returns,
    handler: async (ctx: GenericQueryCtx<DataModel>, argsObject: unknown) => {
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
  }) as RegisteredQuery<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>>
}

export function zInternalQuery<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalQuery: QueryBuilder<DataModel, Visibility>,
  input: A,
  handler: (
    ctx: GenericQueryCtx<DataModel>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredQuery<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  return zQuery(internalQuery, input, handler, options)
}

export function zMutation<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  mutation: MutationBuilder<DataModel, Visibility>,
  input: A,
  handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredMutation<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input as any
    args = zodToConvexFields(getObjectShape(input))
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as any })
    args = { value: zodToConvex(input as any) }
  } else {
    zodSchema = z.object(input as Record<string, any>)
    args = zodToConvexFields(input as Record<string, any>)
  }
  // Skip returns validator for schemas with custom types to avoid type depth issues
  const returns =
    options?.returns && !containsCustom(options.returns) ? zodToConvex(options.returns) : undefined

  return mutation({
    args,
    returns,
    handler: async (ctx: GenericMutationCtx<DataModel>, argsObject: unknown) => {
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
  }) as RegisteredMutation<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>>
}

export function zInternalMutation<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalMutation: MutationBuilder<DataModel, Visibility>,
  input: A,
  handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredMutation<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  return zMutation(internalMutation, input, handler, options)
}

export function zAction<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  action: ActionBuilder<DataModel, Visibility>,
  input: A,
  handler: (
    ctx: GenericActionCtx<DataModel>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredAction<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    zodSchema = input as any
    args = zodToConvexFields(getObjectShape(input))
  } else if (input instanceof z.ZodType) {
    zodSchema = z.object({ value: input as any })
    args = { value: zodToConvex(input as any) }
  } else {
    zodSchema = z.object(input as Record<string, any>)
    args = zodToConvexFields(input as Record<string, any>)
  }
  // Skip returns validator for schemas with custom types to avoid type depth issues
  const returns =
    options?.returns && !containsCustom(options.returns) ? zodToConvex(options.returns) : undefined

  return action({
    args,
    returns,
    handler: async (ctx: GenericActionCtx<DataModel>, argsObject: unknown) => {
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
  }) as RegisteredAction<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>>
}

export function zInternalAction<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined
>(
  internalAction: ActionBuilder<DataModel, Visibility>,
  input: A,
  handler: (
    ctx: GenericActionCtx<DataModel>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredAction<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  return zAction(internalAction, input, handler, options)
}
