import {
  type ActionBuilder,
  type ArgsArrayToObject,
  type DefaultFunctionArgs,
  type FunctionVisibility,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type MutationBuilder,
  type QueryBuilder
} from 'convex/server'
import { type PropertyValidators } from 'convex/values'
import { type Customization, NoOp } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import {
  applyCustomizationResult,
  attachFunctionMeta,
  createConvexReturnsValidator,
  finalizeFunctionReturn,
  normalizeCustomArgsValidator,
  normalizeFunctionSchema,
  parseObjectArgsOrThrow,
  runCustomizationInput
} from './functionContracts'
import { type ZodValidator, zodToConvexFields } from './mapping'
import { assertNoNativeZodDate } from './schema/dateGuards'
import { pick } from './shared/object'
import type { ExtractCtx, ExtractVisibility, Overwrite } from './types'
import { $ZodObject, $ZodType } from './zod-core'

// Type helpers for args transformation (from zodV3 example)
type OneArgArray<ArgsObject extends DefaultFunctionArgs = DefaultFunctionArgs> = [ArgsObject]

// Simple type conversion from a Convex validator to a Zod validator return type
type NullToUndefinedOrNull<T> = T extends null ? T | undefined | void : T
type Returns<T> = Promise<NullToUndefinedOrNull<T>> | NullToUndefinedOrNull<T>

// The return value before it's been validated: returned by the handler
// Uses z.output since the handler produces the internal representation (e.g., Date),
// which is then encoded to wire format (e.g., string) before sending to the client
type ReturnValueInput<ReturnsValidator extends $ZodType | ZodValidator | void> = [
  ReturnsValidator
] extends [$ZodType]
  ? Returns<z.output<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.output<$ZodObject<ReturnsValidator>>>
    : any

// The return value after it's been validated: returned to the client
type ReturnValueOutput<ReturnsValidator extends $ZodType | ZodValidator | void> = [
  ReturnsValidator
] extends [$ZodType]
  ? Returns<z.output<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.output<$ZodObject<ReturnsValidator>>>
    : any

// The args as seen by the caller: runtime types (z.output), not wire types (z.input).
// For codecs (e.g., custom field types), z.output = runtime class, z.input = wire object.
// Callers pass runtime types; encoding to wire format happens inside the wrapper.
type ArgsInput<ArgsValidator extends ZodValidator | $ZodObject | void> = [ArgsValidator] extends [
  $ZodObject
]
  ? [z.output<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.output<$ZodObject<ArgsValidator>>]
    : OneArgArray

// The args after they've been validated: passed to the handler
type ArgsOutput<ArgsValidator extends ZodValidator | $ZodObject | void> = [ArgsValidator] extends [
  $ZodObject
]
  ? [z.output<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.output<$ZodObject<ArgsValidator>>]
    : OneArgArray

// Re-export for backwards compatibility (canonical definition in types.ts)
export type { Overwrite } from './types'

// Hack to simplify how TypeScript renders object types
type Expand<ObjectType extends Record<any, any>> =
  ObjectType extends Record<any, any>
    ? {
        [Key in keyof ObjectType]: ObjectType[Key]
      }
    : never

type ArgsForHandlerType<
  OneOrZeroArgs extends [] | [Record<string, any>],
  CustomMadeArgs extends Record<string, any>
> =
  CustomMadeArgs extends Record<string, never>
    ? OneOrZeroArgs
    : OneOrZeroArgs extends [infer A]
      ? [Expand<A & CustomMadeArgs>]
      : [CustomMadeArgs]

// Helper type for function registration (from zodV3)
type Registration<
  FuncType extends 'query' | 'mutation' | 'action',
  Visibility extends FunctionVisibility,
  Args extends DefaultFunctionArgs,
  Output
> = FuncType extends 'query'
  ? import('convex/server').RegisteredQuery<Visibility, Args, Output>
  : FuncType extends 'mutation'
    ? import('convex/server').RegisteredMutation<Visibility, Args, Output>
    : import('convex/server').RegisteredAction<Visibility, Args, Output>

/**
 * A builder that customizes a Convex function, whether or not it validates
 * arguments. If the customization requires arguments, however, the resulting
 * builder will require argument validation too.
 *
 * This is our own Zod-aware CustomBuilder type that properly handles Zod validators.
 */
export type CustomBuilder<
  FuncType extends 'query' | 'mutation' | 'action',
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  InputCtx,
  Visibility extends FunctionVisibility,
  ExtraArgs extends Record<string, any>
> = {
  <
    ArgsValidator extends ZodValidator | $ZodObject | void,
    ReturnsZodValidator extends $ZodType | ZodValidator | void = void,
    ReturnValue extends ReturnValueInput<ReturnsZodValidator> = any
  >(
    func:
      | ({
          /**
           * Specify the arguments to the function as a Zod validator.
           */
          args?: ArgsValidator
          handler: (
            ctx: Overwrite<InputCtx, CustomCtx>,
            ...args: ArgsForHandlerType<ArgsOutput<ArgsValidator>, CustomMadeArgs>
          ) => ReturnValue
          /**
           * Validates the value returned by the function.
           * Note: you can't pass an object directly without wrapping it
           * in `z.object()`.
           */
          returns?: ReturnsZodValidator
          /**
           * If true, the function will not be validated by Convex,
           * in case you're seeing performance issues with validating twice.
           */
          skipConvexValidation?: boolean
        } & {
          [key in keyof ExtraArgs as key extends
            | 'args'
            | 'handler'
            | 'skipConvexValidation'
            | 'returns'
            ? never
            : key]: ExtraArgs[key]
        })
      | {
          (
            ctx: Overwrite<InputCtx, CustomCtx>,
            ...args: ArgsForHandlerType<ArgsOutput<ArgsValidator>, CustomMadeArgs>
          ): ReturnValue
        }
  ): Registration<
    FuncType,
    Visibility,
    ArgsArrayToObject<
      CustomArgsValidator extends Record<string, never>
        ? ArgsInput<ArgsValidator>
        : ArgsInput<ArgsValidator> extends [infer A]
          ? [Expand<A & import('convex/values').ObjectType<CustomArgsValidator>>]
          : [import('convex/values').ObjectType<CustomArgsValidator>]
    >,
    ReturnsZodValidator extends void ? ReturnValue : ReturnValueOutput<ReturnsZodValidator>
  >
}

export function customFnBuilder<
  Ctx extends Record<string, any>,
  Builder extends (fn: any) => any,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  builder: Builder,
  customization: Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  const customInput = customization.input ?? NoOp.input
  const inputArgs = customization.args ?? NoOp.args

  return function customBuilder(fn: any): any {
    const { args, handler = fn, returns: maybeObject, ...extra } = fn
    const skipConvexValidation = fn.skipConvexValidation ?? false

    const returns = normalizeFunctionSchema(maybeObject)
    const returnValidator = createConvexReturnsValidator(returns, { skipConvexValidation })
    const convexReturns = returnValidator ? { returns: returnValidator } : undefined

    // Check for z.date() usage at construction time (once), not on every invocation
    if (returns) {
      assertNoNativeZodDate(returns as $ZodType, 'returns')
    }

    if (args) {
      const { argsValidator, argsSchema } = normalizeCustomArgsValidator(args)

      // Only generate Convex args validator when not skipping Convex validation
      const convexArgs = skipConvexValidation
        ? inputArgs
        : { ...zodToConvexFields(argsValidator), ...inputArgs }

      // Check for z.date() usage at construction time (once), not on every invocation
      assertNoNativeZodDate(argsSchema, 'args')

      const registered = builder({
        args: convexArgs,
        ...convexReturns,
        handler: async (ctx: Ctx, allArgs: any) => {
          const added = await runCustomizationInput(
            customInput as any,
            ctx,
            allArgs,
            inputArgs,
            extra
          )
          const argKeys = Object.keys(argsValidator)
          const rawArgs = pick(allArgs, argKeys)
          const baseArgs = parseObjectArgsOrThrow(argsSchema, rawArgs)
          const { finalCtx, finalArgs } = applyCustomizationResult(ctx as any, baseArgs, added)

          const ret = await handler(finalCtx, finalArgs)
          return finalizeFunctionReturn(ret, { ctx: ctx as any, args: baseArgs, added, returns })
        }
      })
      attachFunctionMeta(registered, argsSchema, returns)
      return registered
    }
    const registered = builder({
      args: inputArgs,
      ...convexReturns,
      handler: async (ctx: Ctx, allArgs: any) => {
        const baseArgs = allArgs as Record<string, unknown>
        const added = await runCustomizationInput(
          customInput as any,
          ctx,
          allArgs,
          inputArgs,
          extra
        )
        const { finalCtx, finalArgs } = applyCustomizationResult(ctx as any, baseArgs, added)

        const ret = await handler(finalCtx, finalArgs)
        return finalizeFunctionReturn(ret, { ctx: ctx as any, args: baseArgs, added, returns })
      }
    })
    attachFunctionMeta(registered, undefined, returns)
    return registered
  }
}

function createCustomBuilderEntrypoint<
  Builder extends (fn: any) => any,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  builder: Builder,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    builder as any,
    customization as any
  ) as any
}

// Overload 1: With constraint - preferred to preserve DataModel types
export function zCustomQuery<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  query: QueryBuilder<DataModel, Visibility>,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
): CustomBuilder<
  'query',
  CustomArgsValidator,
  CustomCtx,
  CustomMadeArgs,
  GenericQueryCtx<DataModel>,
  Visibility,
  ExtraArgs
>

// Overload 2: No constraint + decoupled ctx
export function zCustomQuery<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  query: QueryBuilder<any, Visibility>,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
): CustomBuilder<
  'query',
  CustomArgsValidator,
  CustomCtx,
  CustomMadeArgs,
  any,
  Visibility,
  ExtraArgs
>

// Implementation
export function zCustomQuery<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  query: QueryBuilder<any, Visibility>,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  // Cast justification: This is the TypeScript overload implementation pattern. The function
  // has two overloads (with/without DataModel constraint) that provide precise types to callers.
  // The implementation must satisfy both overloads, which requires a broader signature.
  // The 'as any' casts allow the implementation to delegate to customFnBuilder without
  // TypeScript complaining about the generic parameter differences between overloads.
  // This is type-safe because: (1) callers only see the overload signatures which are strict,
  // (2) the runtime behavior is identical regardless of which overload matched.
  // TODO: Consider using a conditional type or branded types to create a single signature
  // that satisfies both overloads without casts. Alternatively, accept this as idiomatic
  // TypeScript for overloaded functions and keep the casts.
  return createCustomBuilderEntrypoint(query, customization)
}

// Overload 1: With constraint - preferred to preserve DataModel types
export function zCustomMutation<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Builder extends (fn: any) => any,
  Visibility extends FunctionVisibility = 'public',
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
>

// Implementation
export function zCustomMutation<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Builder extends (fn: any) => any,
  _Visibility extends FunctionVisibility = 'public',
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  mutation: Builder,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  // Cast justification: Same overload implementation pattern as zCustomQuery.
  // See detailed comment there. Type safety is enforced by the overload signature above.
  return createCustomBuilderEntrypoint(mutation, customization)
}

// Overload 1: With constraint - preferred to preserve DataModel types
export function zCustomAction<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Builder extends (fn: any) => any,
  Visibility extends FunctionVisibility = 'public',
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
>

// Implementation
export function zCustomAction<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Builder extends (fn: any) => any,
  _Visibility extends FunctionVisibility = 'public',
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  action: Builder,
  customization: Customization<any, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  // Cast justification: Same overload implementation pattern as zCustomQuery.
  // See detailed comment there. Type safety is enforced by the overload signature above.
  return createCustomBuilderEntrypoint(action, customization)
}
