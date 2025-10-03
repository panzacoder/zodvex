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
import { fromConvexJS, toConvexJS } from './codec'
import { type ZodValidator, zodToConvex, zodToConvexFields } from './mapping'
import type { ExtractCtx, ExtractVisibility } from './types'
import { handleZodValidationError, pick } from './utils'

// Type helpers for args transformation (from zodV3 example)
type OneArgArray<ArgsObject extends DefaultFunctionArgs = DefaultFunctionArgs> = [ArgsObject]

// Simple type conversion from a Convex validator to a Zod validator return type
type NullToUndefinedOrNull<T> = T extends null ? T | undefined | void : T
type Returns<T> = Promise<NullToUndefinedOrNull<T>> | NullToUndefinedOrNull<T>

// The return value before it's been validated: returned by the handler
type ReturnValueInput<ReturnsValidator extends z.ZodTypeAny | ZodValidator | void> = [
  ReturnsValidator
] extends [z.ZodTypeAny]
  ? Returns<z.input<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.input<z.ZodObject<ReturnsValidator>>>
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
  customization: Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
) {
  const customInput = customization.input ?? NoOp.input
  const inputArgs = customization.args ?? NoOp.args

  return function customBuilder(fn: any): any {
    const { args, handler = fn, returns: maybeObject, ...extra } = fn

    const returns =
      maybeObject && !(maybeObject instanceof z.ZodType) ? z.object(maybeObject) : maybeObject
    const returnValidator =
      returns && !fn.skipConvexValidation ? { returns: zodToConvex(returns) } : undefined

    if (args && !fn.skipConvexValidation) {
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

      const convexValidator = zodToConvexFields(argsValidator)
      return builder({
        args: { ...convexValidator, ...inputArgs },
        ...returnValidator,
        handler: async (ctx: Ctx, allArgs: any) => {
          const added: any = await customInput(
            ctx,
            pick(allArgs, Object.keys(inputArgs)) as any,
            extra
          )
          const argKeys = Object.keys(argsValidator)
          const rawArgs = pick(allArgs, argKeys)
          const decoded = fromConvexJS(rawArgs, argsSchema)
          const parsed = argsSchema.safeParse(decoded)
          if (!parsed.success) {
            handleZodValidationError(parsed.error, 'args')
          }
          const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
          const baseArgs = parsed.data as Record<string, unknown>
          const addedArgs = (added?.args as Record<string, unknown>) ?? {}
          const finalArgs = { ...baseArgs, ...addedArgs }
          const ret = await handler(finalCtx, finalArgs)
          if (returns && !fn.skipConvexValidation) {
            let validated: any
            try {
              validated = (returns as z.ZodTypeAny).parse(ret)
            } catch (e) {
              handleZodValidationError(e, 'returns')
            }
            if (added?.onSuccess) {
              await added.onSuccess({ ctx, args: parsed.data, result: validated })
            }
            return toConvexJS(returns as z.ZodTypeAny, validated)
          }
          if (added?.onSuccess) {
            await added.onSuccess({ ctx, args: parsed.data, result: ret })
          }
          return ret
        }
      })
    }
    return builder({
      args: inputArgs,
      ...returnValidator,
      handler: async (ctx: Ctx, allArgs: any) => {
        const added: any = await customInput(
          ctx,
          pick(allArgs, Object.keys(inputArgs)) as any,
          extra
        )
        const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
        const baseArgs = allArgs as Record<string, unknown>
        const addedArgs = (added?.args as Record<string, unknown>) ?? {}
        const finalArgs = { ...baseArgs, ...addedArgs }
        const ret = await handler(finalCtx, finalArgs)
        if (returns && !fn.skipConvexValidation) {
          let validated: any
          try {
            validated = (returns as z.ZodTypeAny).parse(ret)
          } catch (e) {
            handleZodValidationError(e, 'returns')
          }
          if (added?.onSuccess) {
            await added.onSuccess({ ctx, args: allArgs, result: validated })
          }
          return toConvexJS(returns as z.ZodTypeAny, validated)
        }
        if (added?.onSuccess) {
          await added.onSuccess({ ctx, args: allArgs, result: ret })
        }
        return ret
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
  // Implementation deliberately uses 'any' ctx to preserve overload behavior
  // while avoiding a GenericDataModel constraint at the implementation level.
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
  return customFnBuilder<any, Builder, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>(
    action as any,
    customization as any
  ) as any
}
