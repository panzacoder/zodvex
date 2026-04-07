import type {
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'
import { z } from 'zod'
import { getObjectShape, zodToConvex, zodToConvexFields } from './mapping'
import { handleZodValidationError, validateReturns } from './serverUtils'
// Typing helpers to keep handler args/returns precise without deep remapping
import type {
  ExtractCtx,
  ExtractVisibility,
  InferHandlerReturns,
  InferReturns,
  ZodToConvexArgs
} from './types'
import { assertNoNativeZodDate, stripUndefined } from './utils'
import {
  $ZodCustom,
  $ZodDefault,
  $ZodNullable,
  $ZodObject,
  $ZodOptional,
  $ZodType,
  $ZodUnion,
  parse as zodParse
} from './zod-core'

// Cache to avoid re-checking the same schema
const customCheckCache = new WeakMap<$ZodType, boolean>()

/**
 * Check if a schema contains z.custom types (runtime check).
 * Includes depth limit to prevent stack overflow on deeply nested schemas.
 */
function containsCustom(schema: $ZodType, maxDepth = 50, currentDepth = 0): boolean {
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

  // Zod v4 exports ZodCustom and instances expose `schema.type === "custom"`.
  if (schema instanceof $ZodCustom) {
    result = true
  } else if (schema instanceof $ZodUnion) {
    result = schema._zod.def.options.some(opt => containsCustom(opt, maxDepth, currentDepth + 1))
  } else if (schema instanceof $ZodOptional) {
    result = containsCustom(schema._zod.def.innerType, maxDepth, currentDepth + 1)
  } else if (schema instanceof $ZodNullable) {
    result = containsCustom(schema._zod.def.innerType, maxDepth, currentDepth + 1)
  } else if (schema instanceof $ZodDefault) {
    result = containsCustom(schema._zod.def.innerType, maxDepth, currentDepth + 1)
  }

  customCheckCache.set(schema, result)
  return result
}

type ZodFunctionInput = $ZodType | Record<string, $ZodType>

function normalizeFunctionInput(input: ZodFunctionInput): {
  zodSchema: $ZodType
  args: Record<string, any>
} {
  if (input instanceof $ZodObject) {
    const zodObj = input as $ZodObject
    return {
      zodSchema: zodObj,
      args: zodToConvexFields(getObjectShape(zodObj))
    }
  }

  if (input instanceof $ZodType) {
    return {
      zodSchema: z.object({ value: input as any }),
      args: { value: zodToConvex(input as any) }
    }
  }

  return {
    zodSchema: z.object(input as Record<string, any>),
    args: zodToConvexFields(input as Record<string, any>)
  }
}

function createReturnsValidator(schema?: $ZodType): any {
  return schema && !containsCustom(schema) ? zodToConvex(schema) : undefined
}

function assertNoNativeDateSchemas(argsSchema: $ZodType, returnsSchema?: $ZodType): void {
  assertNoNativeZodDate(argsSchema, 'args')
  if (returnsSchema) {
    assertNoNativeZodDate(returnsSchema, 'returns')
  }
}

function parseArgsOrThrow(zodSchema: $ZodType, argsObject: unknown): any {
  try {
    return zodParse(zodSchema, argsObject) as any
  } catch (e) {
    handleZodValidationError(e, 'args')
  }
}

async function validateReturnValue(raw: unknown, returnsSchema?: $ZodType): Promise<any> {
  if (returnsSchema) {
    const validated = validateReturns(returnsSchema, raw)
    return stripUndefined(validated)
  }
  return stripUndefined(raw) as any
}

function registerZodFunction<
  Builder extends (fn: any) => any,
  A extends ZodFunctionInput,
  R extends $ZodType | undefined
>(
  builder: Builder,
  input: A,
  handler: (ctx: ExtractCtx<Builder>, args: ZodToConvexArgs<A>) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): any {
  const { zodSchema, args } = normalizeFunctionInput(input)
  const returnsSchema = options?.returns as $ZodType | undefined
  const returns = createReturnsValidator(returnsSchema)

  assertNoNativeDateSchemas(zodSchema, returnsSchema)

  return builder({
    args,
    returns,
    handler: async (ctx: any, argsObject: unknown) => {
      const parsed = parseArgsOrThrow(zodSchema, argsObject)
      const raw = await handler(ctx, parsed)
      return validateReturnValue(raw, returnsSchema)
    }
  }) as any
}

export function zQuery<
  Builder extends (fn: any) => any,
  A extends $ZodType | Record<string, $ZodType>,
  R extends $ZodType | undefined = undefined,
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
  return registerZodFunction(query, input, handler, options)
}

export function zInternalQuery<
  Builder extends (fn: any) => any,
  A extends $ZodType | Record<string, $ZodType>,
  R extends $ZodType | undefined = undefined,
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
  A extends $ZodType | Record<string, $ZodType>,
  R extends $ZodType | undefined = undefined,
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
  return registerZodFunction(mutation, input, handler, options)
}

export function zInternalMutation<
  Builder extends (fn: any) => any,
  A extends $ZodType | Record<string, $ZodType>,
  R extends $ZodType | undefined = undefined,
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
  A extends $ZodType | Record<string, $ZodType>,
  R extends $ZodType | undefined = undefined,
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
  return registerZodFunction(action, input, handler, options)
}

export function zInternalAction<
  Builder extends (fn: any) => any,
  A extends $ZodType | Record<string, $ZodType>,
  R extends $ZodType | undefined = undefined,
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
