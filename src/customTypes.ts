import type {
  ArgsArrayForOptionalValidator,
  ArgsArrayToObject,
  DefaultArgsForOptionalValidator,
  DefaultFunctionArgs,
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
  ReturnValueForOptionalValidator,
  TableDefinition
} from 'convex/server'
import { defineTable } from 'convex/server'
import type { GenericValidator, ObjectType, PropertyValidators, Validator } from 'convex/values'
import { v } from 'convex/values'

// Helper type to expand object types for better IDE hints
type Expand<T extends Record<any, any>> = T extends Record<any, any>
  ? { [K in keyof T]: T[K] }
  : never

// Helper type to overwrite properties in T with those in U
type Overwrite<T, U> = keyof U extends never ? T : Omit<T, keyof U> & U

/**
 * A customization of a query, mutation, or action.
 * It can specify common arguments that all defined functions take in,
 * as well as modify the ctx and args arguments to each function.
 */
export type Customization<
  Ctx extends Record<string, any>,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any> = Record<string, any>
> = {
  args: CustomArgsValidator
  input: (
    ctx: Ctx,
    args: ObjectType<CustomArgsValidator>,
    extra: ExtraArgs
  ) =>
    | Promise<{
        ctx: CustomCtx
        args: CustomMadeArgs
        onSuccess?: (obj: {
          ctx: Ctx
          args: Record<string, unknown>
          result: unknown
        }) => void | Promise<void>
      }>
    | {
        ctx: CustomCtx
        args: CustomMadeArgs
        onSuccess?: (obj: {
          ctx: Ctx
          args: Record<string, unknown>
          result: unknown
        }) => void | Promise<void>
      }
}

/**
 * A Customization that doesn't add or remove any context or args.
 */
export const NoOp = {
  args: {} as PropertyValidators,
  input() {
    return {
      args: {},
      ctx: {}
    }
  }
}

// Helper type for function registration
type Registration<
  FuncType extends 'query' | 'mutation' | 'action',
  Visibility extends FunctionVisibility,
  Args extends DefaultFunctionArgs,
  Output
> = {
  query: RegisteredQuery<Visibility, Args, Output>
  mutation: RegisteredMutation<Visibility, Args, Output>
  action: RegisteredAction<Visibility, Args, Output>
}[FuncType]

// Helper type for handler args
type ArgsForHandlerType<
  OneOrZeroArgs extends [] | [Record<string, any>],
  CustomMadeArgs extends Record<string, any>
> = CustomMadeArgs extends Record<string, never>
  ? OneOrZeroArgs
  : OneOrZeroArgs extends [infer A]
    ? [Expand<A & CustomMadeArgs>]
    : [CustomMadeArgs]

/**
 * A builder that customizes a Convex function
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
    ArgsValidator extends PropertyValidators | void | Validator<any, any, any>,
    ReturnsValidator extends PropertyValidators | GenericValidator | void,
    ReturnValue extends ReturnValueForOptionalValidator<ReturnsValidator> = any,
    OneOrZeroArgs extends
      ArgsArrayForOptionalValidator<ArgsValidator> = DefaultArgsForOptionalValidator<ArgsValidator>
  >(
    func:
      | ({
          args?: ArgsValidator
          returns?: ReturnsValidator
          handler: (
            ctx: Overwrite<InputCtx, CustomCtx>,
            ...args: ArgsForHandlerType<OneOrZeroArgs, CustomMadeArgs>
          ) => ReturnValue
        } & {
          [key in keyof ExtraArgs as key extends 'args' | 'returns' | 'handler'
            ? never
            : key]: ExtraArgs[key]
        })
      | ((
          ctx: Overwrite<InputCtx, CustomCtx>,
          ...args: ArgsForHandlerType<OneOrZeroArgs, CustomMadeArgs>
        ) => ReturnValue)
  ): Registration<
    FuncType,
    Visibility,
    ArgsArrayToObject<
      CustomArgsValidator extends Record<string, never>
        ? OneOrZeroArgs
        : OneOrZeroArgs extends [infer A]
          ? [Expand<A & ObjectType<CustomArgsValidator>>]
          : [ObjectType<CustomArgsValidator>]
    >,
    ReturnValue
  >
}

/**
 * Define a table with system fields _id and _creationTime.
 * This also returns helpers for working with the table in validators.
 */
export function Table<T extends Record<string, Validator<any, any, any>>, TableName extends string>(
  name: TableName,
  fields: T
): {
  name: TableName
  table: TableDefinition<any>
  doc: Validator<any, any, any>
  withoutSystemFields: T
  withSystemFields: any
  systemFields: any
  _id: Validator<any, any, any>
} {
  const systemFields = {
    _id: v.id(name as TableName),
    _creationTime: v.float64()
  }

  const withSystemFields = {
    ...fields,
    ...systemFields
  }

  return {
    name,
    table: defineTable(fields),
    doc: v.object(withSystemFields),
    withoutSystemFields: fields,
    withSystemFields,
    systemFields,
    _id: systemFields._id
  }
}
