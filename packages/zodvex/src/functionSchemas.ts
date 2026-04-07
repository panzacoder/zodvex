import { z } from 'zod'
import { attachMeta } from './meta'
import { $ZodObject, $ZodType } from './zod-core'

export type FunctionSchemaInput = $ZodType | Record<string, $ZodType> | undefined

export function normalizeFunctionSchema(input: FunctionSchemaInput): $ZodType | undefined {
  if (!input) return undefined
  return input instanceof $ZodType ? input : z.object(input)
}

export function normalizeFunctionMetaArgs(input: FunctionSchemaInput): z.ZodObject<any> | undefined {
  if (!input) return undefined
  if (input instanceof $ZodObject) {
    return input as unknown as z.ZodObject<any> // zod-ok
  }
  if (input instanceof $ZodType) {
    return undefined
  }
  return z.object(input)
}

export function attachFunctionMeta(
  target: object,
  args: FunctionSchemaInput,
  returns: FunctionSchemaInput
): void {
  attachMeta(target, {
    type: 'function',
    zodArgs: normalizeFunctionMetaArgs(args),
    zodReturns: normalizeFunctionSchema(returns)
  })
}
