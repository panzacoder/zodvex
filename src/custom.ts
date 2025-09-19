import {
  type FunctionVisibility,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type QueryBuilder,
  type MutationBuilder,
  type ActionBuilder
} from 'convex/server'
import { ConvexError, type PropertyValidators } from 'convex/values'
import { type CustomBuilder, type Customization, NoOp } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import { toConvexJS, fromConvexJS } from './codec'
import { zodToConvex, zodToConvexFields } from './mapping'
import { pick, formatZodIssues } from './utils'

function customFnBuilder<
  Ctx extends Record<string, any>,
  Builder extends (fn: any) => any,
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  builder: Builder,
  customization: Customization<
    Ctx,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >
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
      if (argsValidator instanceof z.ZodType) {
        if (argsValidator instanceof z.ZodObject) {
          argsValidator = (argsValidator as z.ZodObject<any>).shape
        } else {
          throw new Error(
            'Unsupported zod type as args validator: ' + argsValidator.constructor.name
          )
        }
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
          const rawArgs = pick(allArgs, Object.keys(argsValidator))
          const argsSchema = z.object(argsValidator)
          const decoded = fromConvexJS(rawArgs, argsSchema)
          const parsed = argsSchema.safeParse(decoded)
          if (!parsed.success) {
            throw new ConvexError(formatZodIssues(parsed.error, 'args'))
          }
          const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
          const finalArgs = { ...parsed.data, ...(added?.args ?? {}) }
          const ret = await handler(finalCtx, finalArgs)
          if (returns && !fn.skipConvexValidation) {
            let validated: any
            try {
              validated = (returns as z.ZodTypeAny).parse(ret)
            } catch (e) {
              if (e instanceof z.ZodError) {
                throw new ConvexError(formatZodIssues(e, 'returns'))
              }
              throw e
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
        const finalArgs = { ...allArgs, ...(added?.args ?? {}) }
        const ret = await handler(finalCtx, finalArgs)
        if (returns && !fn.skipConvexValidation) {
          let validated: any
          try {
            validated = (returns as z.ZodTypeAny).parse(ret)
          } catch (e) {
            if (e instanceof z.ZodError) {
              throw new ConvexError(formatZodIssues(e, 'returns'))
            }
            throw e
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

export function zCustomQuery<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  query: QueryBuilder<DataModel, Visibility>,
  customization: Customization<
    GenericQueryCtx<DataModel>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >
) {
  return customFnBuilder<
    GenericQueryCtx<DataModel>,
    typeof query,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >(query, customization) as CustomBuilder<
    'query',
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    GenericQueryCtx<DataModel>,
    Visibility,
    ExtraArgs
  >
}

export function zCustomMutation<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  mutation: MutationBuilder<DataModel, Visibility>,
  customization: Customization<
    GenericMutationCtx<DataModel>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >
) {
  return customFnBuilder<
    GenericMutationCtx<DataModel>,
    typeof mutation,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >(mutation, customization) as CustomBuilder<
    'mutation',
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    GenericMutationCtx<DataModel>,
    Visibility,
    ExtraArgs
  >
}

export function zCustomAction<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  action: ActionBuilder<DataModel, Visibility>,
  customization: Customization<
    GenericActionCtx<DataModel>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >
) {
  return customFnBuilder<
    GenericActionCtx<DataModel>,
    typeof action,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >(action, customization) as CustomBuilder<
    'action',
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    GenericActionCtx<DataModel>,
    Visibility,
    ExtraArgs
  >
}
