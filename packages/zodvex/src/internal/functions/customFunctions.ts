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
import { type PropertyValidators, type Validator } from 'convex/values'
import { type Customization, NoOp } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import { type ZodValidator, zodToConvexFields } from '../mapping'
import { assertNoNativeZodDate } from '../schema/dateGuards'
import { pick } from '../shared/object'
import type { ExtractCtx, ExtractVisibility, Overwrite } from '../types'
import { $ZodObject, $ZodType } from '../zod-core'
import {
  applyCustomizationResult,
  attachFunctionMeta,
  createConvexReturnsValidator,
  finalizeFunctionReturn,
  normalizeCustomArgsValidator,
  normalizeFunctionSchema,
  parseObjectArgsOrThrow,
  runCustomizationInput
} from './contracts'

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
export type { Overwrite } from '../types'

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
    : OneOrZeroArgs extends [infer A extends Record<string, any>]
      ? [Expand<Overwrite<A, CustomMadeArgs>>]
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

type CustomFunction<
  ArgsValidator extends ZodValidator | $ZodObject | void,
  ReturnsZodValidator extends $ZodType | ZodValidator | void,
  ReturnValue,
  InputCtx,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any>
> =
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
      [key in keyof ExtraArgs as key extends 'args' | 'handler' | 'skipConvexValidation' | 'returns'
        ? never
        : key]: ExtraArgs[key]
    })
  | {
      (
        ctx: Overwrite<InputCtx, CustomCtx>,
        ...args: ArgsForHandlerType<ArgsOutput<ArgsValidator>, CustomMadeArgs>
      ): ReturnValue
    }

/**
 * A builder that customizes a Convex function, whether or not it validates
 * arguments. If the customization requires arguments, however, the resulting
 * builder will require argument validation too.
 *
 * This is our own Zod-aware CustomBuilder type that properly handles Zod validators.
 */
export type CustomBuilder<
  FuncType extends 'query' | 'mutation' | 'action',
  // The customization's caller-facing args as a resolved object type (the args
  // the caller must supply so the customization's `input` can consume them).
  // Resolved rather than a `PropertyValidators` slot so zodvex customizations
  // (`.withContext({ args: <zod> })`) can express decoded-runtime arg types. #72
  CustomArgs extends Record<string, any>,
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
    func: CustomFunction<
      ArgsValidator,
      ReturnsZodValidator,
      ReturnValue,
      InputCtx,
      CustomCtx,
      CustomMadeArgs,
      ExtraArgs
    >
  ): Registration<
    FuncType,
    Visibility,
    ArgsArrayToObject<
      CustomArgs extends Record<string, never>
        ? ArgsInput<ArgsValidator>
        : ArgsInput<ArgsValidator> extends [infer A]
          ? [Expand<A & CustomArgs>]
          : [CustomArgs]
    >,
    ReturnsZodValidator extends void ? ReturnValue : ReturnValueOutput<ReturnsZodValidator>
  >
}

function isZodArgs(args: Record<string, unknown>): args is ZodValidator {
  const values = Object.values(args)
  return values.length > 0 && values.every(value => value instanceof $ZodType)
}

type NativeFunction<Ctx> = {
  args: PropertyValidators
  returns?: Validator<any>
  handler: (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>
}

type BuilderCtx<Builder> =
  Builder extends QueryBuilder<infer DM, FunctionVisibility>
    ? GenericQueryCtx<DM>
    : Builder extends MutationBuilder<infer DM, FunctionVisibility>
      ? GenericMutationCtx<DM>
      : Builder extends ActionBuilder<infer DM, FunctionVisibility>
        ? GenericActionCtx<DM>
        : Record<string, unknown>

export function customFnBuilder<
  Builder extends (fn: any) => object,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any> = Record<string, any>,
  Ctx extends Record<string, any> = BuilderCtx<Builder>
>(
  builder: Builder,
  customization: Customization<
    NoInfer<Ctx>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >
) {
  const customInput = customization.input ?? NoOp.input
  const rawInputArgs = customization.args ?? NoOp.args

  // #72: a customization may declare its args as zod (e.g. a codec-typed arg in
  // `.withContext({ args: { token: myCodec } })`). Those must enter the same
  // pipeline as consumer args — converted to Convex validators for registration
  // and codec-decoded before `input` runs. Pre-built Convex validators (the
  // legacy shape) are passed through unchanged for back-compat.
  const customArgsAreZod = isZodArgs(rawInputArgs)
  const inputArgs = customArgsAreZod ? zodToConvexFields(rawInputArgs) : rawInputArgs
  const customArgsSchema = customArgsAreZod ? z.object(rawInputArgs) : undefined

  return function customBuilder<
    ArgsValidator extends ZodValidator | $ZodObject | void,
    ReturnsValidator extends $ZodType | ZodValidator | void = void,
    Result extends ReturnValueInput<ReturnsValidator> = any
  >(
    fn: CustomFunction<
      ArgsValidator,
      ReturnsValidator,
      Result,
      Ctx,
      CustomCtx,
      CustomMadeArgs,
      ExtraArgs
    >
  ) {
    type Properties = Exclude<typeof fn, (...args: any[]) => unknown>
    // Shorthand functions may carry validators/options as own properties.
    // Read the original object so enumerable custom options survive unchanged.
    const properties = fn as typeof fn & Partial<Properties>
    const { args, handler: attachedHandler, returns: maybeObject, ...extra } = properties
    const handler = attachedHandler ?? (typeof fn === 'function' ? fn : fn.handler)
    const skipConvexValidation = properties.skipConvexValidation ?? false

    const returns = normalizeFunctionSchema(maybeObject || undefined)
    const returnValidator = createConvexReturnsValidator(returns, { skipConvexValidation })
    const convexReturns = returnValidator ? { returns: returnValidator } : undefined

    // Check for z.date() usage at construction time (once), not on every invocation
    if (returns) {
      assertNoNativeZodDate(returns, 'returns')
    }

    const normalizedArgs = args ? normalizeCustomArgsValidator(args) : undefined
    if (normalizedArgs) assertNoNativeZodDate(normalizedArgs.argsSchema, 'args')
    const convexArgs =
      normalizedArgs && !skipConvexValidation
        ? { ...zodToConvexFields(normalizedArgs.argsValidator), ...inputArgs }
        : inputArgs

    const nativeDefinition: NativeFunction<Ctx> = {
      args: convexArgs,
      ...convexReturns,
      handler: async (ctx: Ctx, allArgs: Record<string, unknown>) => {
        const added = await runCustomizationInput(
          customInput,
          ctx,
          allArgs,
          inputArgs,
          // Reserved function fields are removed before forwarding customization options.
          // Plain shorthand forwards an empty options object.
          extra as unknown as ExtraArgs,
          customArgsSchema
        )
        const baseArgs = normalizedArgs
          ? parseObjectArgsOrThrow(
              normalizedArgs.argsSchema,
              pick(allArgs, Object.keys(normalizedArgs.argsValidator))
            )
          : allArgs
        const { finalCtx, finalArgs } = applyCustomizationResult(ctx, baseArgs, added)
        // Runtime selection/decoding and object spread implement these public
        // conditional types, which TS cannot narrow using the optional args branch.
        const ret = await handler(
          finalCtx as Overwrite<Ctx, CustomCtx>,
          ...([finalArgs] as ArgsForHandlerType<ArgsOutput<ArgsValidator>, CustomMadeArgs>)
        )
        return finalizeFunctionReturn(ret, { ctx, args: baseArgs, added, returns })
      }
    }
    // Convex's generic call signature cannot retain its instantiated return
    // through a generic factory; keep the actual registered object's type.
    const registered = builder(nativeDefinition) as ReturnType<Builder>
    // Mini objects have no .extend(); custom schemas win metadata key conflicts.
    const metaArgsSchema = normalizedArgs
      ? customArgsSchema
        ? z.object({
            ...normalizedArgs.argsSchema._zod.def.shape,
            ...customArgsSchema._zod.def.shape
          })
        : normalizedArgs.argsSchema
      : customArgsSchema
    attachFunctionMeta(registered, metaArgsSchema, returns)
    return registered
  }
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
  import('convex/values').ObjectType<CustomArgsValidator>,
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
  import('convex/values').ObjectType<CustomArgsValidator>,
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
  return customFnBuilder<
    QueryBuilder<any, Visibility>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >(query, customization)
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
  import('convex/values').ObjectType<CustomArgsValidator>,
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
  return customFnBuilder<Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    mutation,
    customization
  )
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
  import('convex/values').ObjectType<CustomArgsValidator>,
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
  return customFnBuilder<Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    action,
    customization
  )
}
