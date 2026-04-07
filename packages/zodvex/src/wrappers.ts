import type {
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'
import {
  assertFunctionSchemas,
  createConvexReturnsValidator,
  type DirectFunctionInput,
  finalizeFunctionReturn,
  normalizeDirectFunctionInput,
  parseFunctionArgsOrThrow
} from './functionContracts'
// Typing helpers to keep handler args/returns precise without deep remapping
import type {
  ExtractCtx,
  ExtractVisibility,
  InferHandlerReturns,
  InferReturns,
  ZodToConvexArgs
} from './types'
import { $ZodType } from './zod-core'

function registerZodFunction<
  Builder extends (fn: any) => any,
  A extends DirectFunctionInput,
  R extends $ZodType | undefined
>(
  builder: Builder,
  input: A,
  handler: (
    ctx: ExtractCtx<Builder>,
    args: ZodToConvexArgs<A>
  ) => InferHandlerReturns<R> | Promise<InferHandlerReturns<R>>,
  options?: { returns?: R }
): any {
  const { zodSchema, convexArgs } = normalizeDirectFunctionInput(input)
  const returnsSchema = options?.returns as $ZodType | undefined
  const returns = createConvexReturnsValidator(returnsSchema, { skipCustomSchemas: true })

  assertFunctionSchemas(zodSchema, returnsSchema)

  return builder({
    args: convexArgs,
    returns,
    handler: async (ctx: any, argsObject: unknown) => {
      const parsed = parseFunctionArgsOrThrow(zodSchema, argsObject)
      const raw = await handler(ctx, parsed)
      return finalizeFunctionReturn(raw, { returns: returnsSchema })
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
