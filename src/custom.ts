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
import { ConvexError, type PropertyValidators } from 'convex/values'
import { type Customization, NoOp } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import { type ZodValidator, zodToConvex, zodToConvexFields } from './mapping'
import type { ExtractCtx, ExtractVisibility } from './types'
import {
  assertNoNativeZodDate,
  handleZodValidationError,
  pick,
  stripUndefined,
  validateReturns
} from './utils'

/**
 * @deprecated Use `onSuccess` in convex-helpers' `Customization` type instead.
 */
export type CustomizationHooks = {
  /** Called after successful execution with access to ctx, args, and result */
  onSuccess?: (info: {
    ctx: unknown
    args: Record<string, unknown>
    result: unknown
  }) => void | Promise<void>
}

/**
 * @deprecated Transforms are no longer needed. Use `onSuccess` for output observation
 * and consumer logic in `customCtx` for input transformation.
 */
export type CustomizationTransforms = {
  /** Transform args after validation but before handler receives them */
  input?: (args: unknown, schema: z.ZodTypeAny) => unknown | Promise<unknown>
  /** Transform the output after validation but before wire encoding */
  output?: (result: unknown, schema: z.ZodTypeAny) => unknown | Promise<unknown>
}

/**
 * Result returned from a customization input function.
 * Separates Convex concepts (ctx, args) from hooks (side effects) and transforms (data modifications).
 */
export type CustomizationResult<
  CustomCtx extends Record<string, any> = Record<string, any>,
  CustomArgs extends Record<string, any> = Record<string, any>
> = {
  /** Custom context to merge with base context */
  ctx?: CustomCtx
  /** Custom args to merge with parsed args */
  args?: CustomArgs
  /** Hooks for observing execution (side effects) */
  hooks?: CustomizationHooks
  /** Transforms for modifying the data flow */
  transforms?: CustomizationTransforms
}

/**
 * Extended input result that includes hooks and transforms.
 * This is what the input function returns internally.
 */
export type CustomizationInputResult<
  OutCtx extends Record<string, any>,
  OutArgs extends Record<string, any>
> = {
  ctx: OutCtx
  args: OutArgs
  hooks?: CustomizationHooks
  transforms?: CustomizationTransforms
}

/**
 * @deprecated Use `Customization` from 'convex-helpers/server/customFunctions' instead.
 */
export type CustomizationWithHooks<
  InCtx extends Record<string, any>,
  OutCtx extends Record<string, any> = Record<string, any>,
  OutArgs extends Record<string, any> = Record<string, any>,
  ExtraArgs extends Record<string, any> = Record<string, any>
> = {
  args: Record<string, never>
  input: (
    ctx: InCtx,
    args?: Record<string, unknown>,
    extra?: ExtraArgs
  ) =>
    | Promise<CustomizationInputResult<OutCtx, OutArgs>>
    | CustomizationInputResult<OutCtx, OutArgs>
}

/**
 * @deprecated Use `customCtx` from 'convex-helpers/server/customFunctions' instead.
 * With the pipeline ordering fix, `onSuccess` in convex-helpers' `Customization` type
 * now correctly sees runtime types (Date, SensitiveWrapper) before Zod encoding.
 */
export function customCtxWithHooks<
  InCtx extends Record<string, any>,
  OutCtx extends Record<string, any> = Record<string, any>,
  OutArgs extends Record<string, any> = Record<string, any>
>(
  fn: (
    ctx: InCtx
  ) => Promise<CustomizationResult<OutCtx, OutArgs>> | CustomizationResult<OutCtx, OutArgs>
): CustomizationWithHooks<InCtx, OutCtx, OutArgs> {
  return {
    args: {},
    input: async (ctx: InCtx): Promise<CustomizationInputResult<OutCtx, OutArgs>> => {
      const result = await fn(ctx)
      return {
        ctx: result.ctx ?? ({} as OutCtx),
        args: result.args ?? ({} as OutArgs),
        hooks: result.hooks,
        transforms: result.transforms
      }
    }
  }
}

// Emit each deprecation warning at most once per process
const _warnedTransforms = { input: false, output: false }

// Type helpers for args transformation (from zodV3 example)
type OneArgArray<ArgsObject extends DefaultFunctionArgs = DefaultFunctionArgs> = [ArgsObject]

// Simple type conversion from a Convex validator to a Zod validator return type
type NullToUndefinedOrNull<T> = T extends null ? T | undefined | void : T
type Returns<T> = Promise<NullToUndefinedOrNull<T>> | NullToUndefinedOrNull<T>

// The return value before it's been validated: returned by the handler
// Uses z.output since the handler produces the internal representation (e.g., Date),
// which is then encoded to wire format (e.g., string) before sending to the client
type ReturnValueInput<ReturnsValidator extends z.ZodTypeAny | ZodValidator | void> = [
  ReturnsValidator
] extends [z.ZodTypeAny]
  ? Returns<z.output<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.output<z.ZodObject<ReturnsValidator>>>
    : any

// The return value after it's been validated: returned to the client
type ReturnValueOutput<ReturnsValidator extends z.ZodTypeAny | ZodValidator | void> = [
  ReturnsValidator
] extends [z.ZodTypeAny]
  ? Returns<z.output<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.output<z.ZodObject<ReturnsValidator>>>
    : any

// The args before they've been validated: passed from the client
type ArgsInput<ArgsValidator extends ZodValidator | z.ZodObject<any> | void> = [
  ArgsValidator
] extends [z.ZodObject<any>]
  ? [z.input<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.input<z.ZodObject<ArgsValidator>>]
    : OneArgArray

// The args after they've been validated: passed to the handler
type ArgsOutput<ArgsValidator extends ZodValidator | z.ZodObject<any> | void> = [
  ArgsValidator
] extends [z.ZodObject<any>]
  ? [z.output<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.output<z.ZodObject<ArgsValidator>>]
    : OneArgArray

type Overwrite<T, U> = Omit<T, keyof U> & U

// Hack to simplify how TypeScript renders object types
type Expand<ObjectType extends Record<any, any>> = ObjectType extends Record<any, any>
  ? {
      [Key in keyof ObjectType]: ObjectType[Key]
    }
  : never

type ArgsForHandlerType<
  OneOrZeroArgs extends [] | [Record<string, any>],
  CustomMadeArgs extends Record<string, any>
> = CustomMadeArgs extends Record<string, never>
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
    ArgsValidator extends ZodValidator | z.ZodObject<any> | void,
    ReturnsZodValidator extends z.ZodTypeAny | ZodValidator | void = void,
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
  customization:
    | Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
    | CustomizationWithHooks<Ctx, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  const customInput = customization.input ?? NoOp.input
  const inputArgs = customization.args ?? NoOp.args

  return function customBuilder(fn: any): any {
    const { args, handler = fn, returns: maybeObject, ...extra } = fn
    const skipConvexValidation = fn.skipConvexValidation ?? false

    const returns =
      maybeObject && !(maybeObject instanceof z.ZodType) ? z.object(maybeObject) : maybeObject
    // Only generate Convex return validator when not skipping Convex validation
    const returnValidator =
      returns && !skipConvexValidation ? { returns: zodToConvex(returns) } : undefined

    // Check for z.date() usage at construction time (once), not on every invocation
    if (returns) {
      assertNoNativeZodDate(returns as z.ZodTypeAny, 'returns')
    }

    if (args) {
      let argsValidator = args
      let argsSchema: z.ZodObject<any>

      if (argsValidator instanceof z.ZodType) {
        if (argsValidator instanceof z.ZodObject) {
          argsSchema = argsValidator
          argsValidator = argsValidator.shape // Get the raw shape for zodToConvexFields
        } else {
          throw new Error(
            'Unsupported non-object Zod schema for args; please provide an args schema using z.object({...}), e.g. z.object({ foo: z.string() })'
          )
        }
      } else {
        // It's a raw shape object with Zod validators as values
        argsSchema = z.object(argsValidator)
      }

      // Only generate Convex args validator when not skipping Convex validation
      const convexArgs = skipConvexValidation
        ? inputArgs
        : { ...zodToConvexFields(argsValidator), ...inputArgs }

      // Check for z.date() usage at construction time (once), not on every invocation
      assertNoNativeZodDate(argsSchema, 'args')

      return builder({
        args: convexArgs,
        ...returnValidator,
        handler: async (ctx: Ctx, allArgs: any) => {
          // Cast justification: customInput expects ObjectType<CustomArgsValidator>, but pick()
          // returns Partial<T>. The cast is safe because inputArgs keys are derived from
          // CustomArgsValidator at the type level. The 'added' result is typed as 'any' because
          // it may include hooks/transforms from CustomizationWithHooks which aren't in the
          // convex-helpers Customization type.
          // TODO: Create a type-safe pickArgs<T>() helper that preserves the ObjectType<T>
          // return type when the keys are statically known from the validator.
          const added: any = await customInput(
            ctx,
            pick(allArgs, Object.keys(inputArgs)) as any,
            extra
          )
          const argKeys = Object.keys(argsValidator)
          const rawArgs = pick(allArgs, argKeys)
          // Zod handles codec transforms natively via safeParse
          const parsed = argsSchema.safeParse(rawArgs)
          if (!parsed.success) {
            handleZodValidationError(parsed.error, 'args')
          }
          const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
          const baseArgs = parsed.data as Record<string, unknown>
          const addedArgs = (added?.args as Record<string, unknown>) ?? {}
          let finalArgs = { ...baseArgs, ...addedArgs }

          // Apply input transform if provided (after validation, before handler)
          if (added?.transforms?.input) {
            if (!_warnedTransforms.input) {
              _warnedTransforms.input = true
              console.warn(
                '[zodvex] transforms.input is deprecated. Transform args in your customCtx input() function instead.'
              )
            }
            finalArgs = (await added.transforms.input(finalArgs, argsSchema)) as Record<
              string,
              unknown
            >
          }

          const ret = await handler(finalCtx, finalArgs)

          // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
          if (added?.hooks?.onSuccess) {
            await added.hooks.onSuccess({
              ctx: finalCtx,
              args: parsed.data,
              result: ret
            })
          }

          // Always run Zod return validation when returns schema is provided
          if (returns) {
            let preTransformed = ret
            if (added?.transforms?.output) {
              if (!_warnedTransforms.output) {
                _warnedTransforms.output = true
                console.warn(
                  '[zodvex] transforms.output is deprecated. Use onSuccess in your Customization instead. ' +
                    'onSuccess now correctly sees runtime types (Date, SensitiveWrapper) before Zod encoding.'
                )
              }
              preTransformed = await added.transforms.output(ret, returns as z.ZodTypeAny)
            }

            // Validate and encode using z.encode (Zod handles codecs natively)
            const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)
            return stripUndefined(validated)
          }
          return stripUndefined(ret)
        }
      })
    }
    return builder({
      args: inputArgs,
      ...returnValidator,
      handler: async (ctx: Ctx, allArgs: any) => {
        // Cast justification: Same as above - customInput expects ObjectType<CustomArgsValidator>
        // but pick() returns Partial<T>. Safe because inputArgs keys match CustomArgsValidator.
        // TODO: Create a type-safe pickArgs<T>() helper (see comment in with-args path above).
        const added: any = await customInput(
          ctx,
          pick(allArgs, Object.keys(inputArgs)) as any,
          extra
        )
        const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
        const baseArgs = allArgs as Record<string, unknown>
        const addedArgs = (added?.args as Record<string, unknown>) ?? {}
        let finalArgs = { ...baseArgs, ...addedArgs }

        // Apply input transform if provided (even without args schema)
        if (added?.transforms?.input) {
          if (!_warnedTransforms.input) {
            _warnedTransforms.input = true
            console.warn(
              '[zodvex] transforms.input is deprecated. Transform args in your customCtx input() function instead.'
            )
          }
          finalArgs = (await added.transforms.input(finalArgs, z.unknown())) as Record<
            string,
            unknown
          >
        }

        const ret = await handler(finalCtx, finalArgs)

        // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
        if (added?.hooks?.onSuccess) {
          await added.hooks.onSuccess({
            ctx: finalCtx,
            args: allArgs,
            result: ret
          })
        }

        if (returns) {
          let preTransformed = ret
          if (added?.transforms?.output) {
            if (!_warnedTransforms.output) {
              _warnedTransforms.output = true
              console.warn(
                '[zodvex] transforms.output is deprecated. Use onSuccess in your Customization instead. ' +
                  'onSuccess now correctly sees runtime types (Date, SensitiveWrapper) before Zod encoding.'
              )
            }
            preTransformed = await added.transforms.output(ret, returns as z.ZodTypeAny)
          }

          // Validate and encode using z.encode (Zod handles codecs natively)
          const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)
          return stripUndefined(validated)
        }
        return stripUndefined(ret)
      }
    })
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
  return customFnBuilder<
    any,
    typeof query,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >(query as any, customization as any) as any
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
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    mutation as any,
    customization as any
  ) as any
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
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    action as any,
    customization as any
  ) as any
}
