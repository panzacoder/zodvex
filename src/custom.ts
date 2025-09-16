import { z } from 'zod'
import { ConvexError } from 'convex/values'
import { type PropertyValidators } from 'convex/values'
import { type FunctionVisibility, type GenericDataModel, type GenericQueryCtx, type GenericMutationCtx, type GenericActionCtx } from 'convex/server'
import { type CustomBuilder, type Customization, NoOp } from 'convex-helpers/server/customFunctions'
import { zodToConvex, zodToConvexFields } from './mapping'
import { toConvexJS } from './codec'
import { pick } from './utils'

function customFnBuilder(
  builder: (args: any) => any,
  customization: Customization<any, any, any, any>
) {
  const customInput = customization.input ?? NoOp.input
  const inputArgs = customization.args ?? NoOp.args

  return function customBuilder(fn: any): any {
    const { args, handler = fn, returns: maybeObject, ...extra } = fn

    const returns = maybeObject && !(maybeObject instanceof z.ZodType) ? z.object(maybeObject) : maybeObject
    const returnValidator = returns && !fn.skipConvexValidation ? { returns: zodToConvex(returns) } : undefined

    if (args && !fn.skipConvexValidation) {
      let argsValidator = args
      if (argsValidator instanceof z.ZodType) {
        if (argsValidator instanceof z.ZodObject) {
          argsValidator = (argsValidator as z.ZodObject<any>).shape
        } else {
          throw new Error('Unsupported zod type as args validator: ' + argsValidator.constructor.name)
        }
      }
      const convexValidator = zodToConvexFields(argsValidator)
      return builder({
        args: { ...convexValidator, ...inputArgs },
        ...returnValidator,
        handler: async (ctx: any, allArgs: any) => {
          const added = await customInput(ctx, pick(allArgs, Object.keys(inputArgs)) as any, extra)
          const rawArgs = pick(allArgs, Object.keys(argsValidator))
          const parsed = z.object(argsValidator).safeParse(rawArgs)
          if (!parsed.success) {
            throw new ConvexError({ ZodError: JSON.parse(JSON.stringify(parsed.error.flatten(), null, 2)) })
          }
          const result = await handler({ ...ctx, ...added }, parsed.data)
          if (returns && !fn.skipConvexValidation) {
            const validated = (returns as z.ZodTypeAny).parse(result)
            return toConvexJS(returns as z.ZodTypeAny, validated)
          }
          return result
        }
      })
    }
    return builder({
      args: inputArgs,
      ...returnValidator,
      handler: async (ctx: any, allArgs: any) => {
        const added = await customInput(ctx, pick(allArgs, Object.keys(inputArgs)) as any, extra)
        const result = await handler({ ...ctx, ...added }, allArgs)
        if (returns && !fn.skipConvexValidation) {
          const validated = (returns as z.ZodTypeAny).parse(result)
          return toConvexJS(returns as z.ZodTypeAny, validated)
        }
        return result
      }
    })
  }
}

export function zCustomQuery<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(
  query: any,
  customization: Customization<GenericQueryCtx<DataModel>, CustomArgsValidator, CustomCtx, CustomMadeArgs>
) {
  return customFnBuilder(query, customization) as CustomBuilder<'query', CustomArgsValidator, CustomCtx, CustomMadeArgs, GenericQueryCtx<DataModel>, Visibility, Record<string, any>>
}

export function zCustomMutation<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(
  mutation: any,
  customization: Customization<GenericMutationCtx<DataModel>, CustomArgsValidator, CustomCtx, CustomMadeArgs>
) {
  return customFnBuilder(mutation, customization) as CustomBuilder<'mutation', CustomArgsValidator, CustomCtx, CustomMadeArgs, GenericMutationCtx<DataModel>, Visibility, Record<string, any>>
}

export function zCustomAction<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(
  action: any,
  customization: Customization<GenericActionCtx<DataModel>, CustomArgsValidator, CustomCtx, CustomMadeArgs>
) {
  return customFnBuilder(action, customization) as CustomBuilder<'action', CustomArgsValidator, CustomCtx, CustomMadeArgs, GenericActionCtx<DataModel>, Visibility, Record<string, any>>
}

