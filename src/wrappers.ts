import type {
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'
import { ConvexError } from 'convex/values'
import { z } from 'zod'
import { fromConvexJS, toConvexJS } from './codec'
import { getObjectShape, zodToConvex, zodToConvexFields } from './mapping'
// Typing helpers to keep handler args/returns precise without deep remapping
import type {
  ExtractCtx,
  ExtractVisibility,
  InferHandlerReturns,
  InferReturns,
  ZodToConvexArgs
} from './types'
import { handleZodValidationError } from './utils'

// Cache to avoid re-checking the same schema
const customCheckCache = new WeakMap<z.ZodTypeAny, boolean>()

/**
 * Check if a schema contains z.custom types (runtime check).
 * Includes depth limit to prevent stack overflow on deeply nested schemas.
 */
function containsCustom(schema: z.ZodTypeAny, maxDepth = 50, currentDepth = 0): boolean {
  // Check cache first
  const cached = customCheckCache.get(schema)
  if (cached !== undefined) {
    return cached
  }

  // Prevent stack overflow on deeply nested schemas
  if (currentDepth > maxDepth) {
    return false
  }

  let result = false

  // Use _def.typeName instead of instanceof since ZodCustom is not exported in Zod v4
  if ((schema as any)._def?.typeName === 'ZodCustom') {
    result = true
  } else if (schema instanceof z.ZodUnion) {
    result = (schema.options as z.ZodTypeAny[]).some(opt =>
      containsCustom(opt, maxDepth, currentDepth + 1)
    )
  } else if (schema instanceof z.ZodOptional) {
    result = containsCustom(schema.unwrap() as z.ZodTypeAny, maxDepth, currentDepth + 1)
  } else if (schema instanceof z.ZodNullable) {
    result = containsCustom(schema.unwrap() as z.ZodTypeAny, maxDepth, currentDepth + 1)
  } else if (schema instanceof z.ZodDefault) {
    result = containsCustom(schema.removeDefault() as z.ZodTypeAny, maxDepth, currentDepth + 1)
  }

  customCheckCache.set(schema, result)
  return result
}

export function zQuery<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>
>(
  query: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredQuery<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    const zodObj = input as z.ZodObject<any>
    zodSchema = zodObj
    args = zodToConvexFields(getObjectShape(zodObj))
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
    handler: async (ctx: any, argsObject: unknown) => {
      const decoded = fromConvexJS(argsObject, zodSchema)
      let parsed: any
      try {
        parsed = zodSchema.parse(decoded) as any
      } catch (e) {
        handleZodValidationError(e, 'args')
      }
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        try {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        } catch (e) {
          handleZodValidationError(e, 'returns')
        }
      }
      // Fallback: ensure Convex-safe return values (e.g., Date → timestamp)
      return toConvexJS(raw) as any
    }
  }) as any
}

export function zInternalQuery<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>
>(
  internalQuery: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredQuery<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  return zQuery(internalQuery, input, handler, options)
}

export function zMutation<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>
>(
  mutation: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredMutation<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    const zodObj = input as z.ZodObject<any>
    zodSchema = zodObj
    args = zodToConvexFields(getObjectShape(zodObj))
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
    handler: async (ctx: any, argsObject: unknown) => {
      const decoded = fromConvexJS(argsObject, zodSchema)
      let parsed: any
      try {
        parsed = zodSchema.parse(decoded) as any
      } catch (e) {
        handleZodValidationError(e, 'args')
      }
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        try {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        } catch (e) {
          handleZodValidationError(e, 'returns')
        }
      }
      // Fallback: ensure Convex-safe return values (e.g., Date → timestamp)
      return toConvexJS(raw) as any
    }
  }) as any
}

export function zInternalMutation<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>
>(
  internalMutation: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredMutation<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  return zMutation(internalMutation, input, handler, options)
}

export function zAction<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>
>(
  action: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredAction<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  let zodSchema: z.ZodTypeAny
  let args: Record<string, any>
  if (input instanceof z.ZodObject) {
    const zodObj = input as z.ZodObject<any>
    zodSchema = zodObj
    args = zodToConvexFields(getObjectShape(zodObj))
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
    handler: async (ctx: any, argsObject: unknown) => {
      const decoded = fromConvexJS(argsObject, zodSchema)
      let parsed: any
      try {
        parsed = zodSchema.parse(decoded) as any
      } catch (e) {
        handleZodValidationError(e, 'args')
      }
      const raw = await handler(ctx, parsed)
      if (options?.returns) {
        try {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        } catch (e) {
          handleZodValidationError(e, 'returns')
        }
      }
      // Fallback: ensure Convex-safe return values (e.g., Date → timestamp)
      return toConvexJS(raw) as any
    }
  }) as any
}

export function zInternalAction<
  Builder extends (fn: any) => any,
  A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
  R extends z.ZodTypeAny | undefined = undefined,
  Visibility extends FunctionVisibility = ExtractVisibility<Builder>
>(
  internalAction: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): RegisteredAction<Visibility, ZodToConvexArgs<A>, Promise<InferReturns<R>>> {
  return zAction(internalAction, input, handler, options) as any
}
