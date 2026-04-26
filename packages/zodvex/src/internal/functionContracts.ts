import { z } from 'zod'
import { getObjectShape, type ZodValidator, zodToConvex, zodToConvexFields } from './mapping'
import { attachMeta } from './meta'
import { assertNoNativeZodDate } from './schema/dateGuards'
import { handleZodValidationError, validateReturns } from './serverUtils'
import { pick } from './shared/object'
import { stripUndefined } from './stripUndefined'
import {
  $ZodCustom,
  $ZodDefault,
  $ZodNullable,
  $ZodObject,
  $ZodOptional,
  $ZodType,
  $ZodUnion,
  safeParse,
  parse as zodParse
} from './zod-core'

export type FunctionSchemaInput = $ZodType | Record<string, $ZodType> | undefined
export type DirectFunctionInput = $ZodType | Record<string, $ZodType>

export type CustomInputResult = {
  ctx?: Record<string, unknown>
  args?: Record<string, unknown>
  onSuccess?: (params: { ctx: unknown; args: unknown; result: unknown }) => unknown
}

export function normalizeFunctionSchema(input: FunctionSchemaInput): $ZodType | undefined {
  if (!input) return undefined
  return input instanceof $ZodType ? input : z.object(input)
}

function normalizeFunctionMetaArgs(input: FunctionSchemaInput): z.ZodObject<any> | undefined {
  if (!input) return undefined
  if (input instanceof $ZodObject) {
    return input as unknown as z.ZodObject<any> // zod-ok
  }
  if (input instanceof $ZodType) {
    return undefined
  }
  return z.object(input)
}

/**
 * Attach function metadata via lazy getters so we don't retain a wrapper
 * ZodObject inside Convex's 64 MB push-time isolate. `meta.zodArgs` /
 * `meta.zodReturns` are only ever read by codegen (extractCodec, discover,
 * generate), which runs in a separate Node process. Building the wrapper
 * there on first access costs nothing at push time.
 */
export function attachFunctionMeta(
  target: object,
  args: FunctionSchemaInput,
  returns: FunctionSchemaInput
): void {
  let cachedArgs: z.ZodObject<any> | undefined
  let argsBuilt = false
  let cachedReturns: $ZodType | undefined
  let returnsBuilt = false

  const meta = {
    type: 'function' as const,
    get zodArgs() {
      if (!argsBuilt) {
        cachedArgs = normalizeFunctionMetaArgs(args)
        argsBuilt = true
      }
      return cachedArgs
    },
    get zodReturns() {
      if (!returnsBuilt) {
        cachedReturns = normalizeFunctionSchema(returns)
        returnsBuilt = true
      }
      return cachedReturns
    }
  }
  attachMeta(target, meta)
}

// Cache to avoid re-checking the same schema
const customCheckCache = new WeakMap<$ZodType, boolean>()

function containsCustom(schema: $ZodType, maxDepth = 50, currentDepth = 0): boolean {
  const cached = customCheckCache.get(schema)
  if (cached !== undefined) {
    return cached
  }

  if (currentDepth > maxDepth) {
    return false
  }

  let result = false
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

/**
 * Discriminated union: either the caller gave us a parseable schema (eager —
 * we keep their ZodObject), or they gave us a raw shape and the wrapper will
 * build `z.object(shape)` inside its handler per request (lazy — keeps the
 * ZodObject out of the wrapper's closure).
 */
export type NormalizedDirectInput =
  | { zodSchema: $ZodType; argsShape?: undefined; convexArgs: Record<string, any> }
  | { zodSchema?: undefined; argsShape: ZodValidator; convexArgs: Record<string, any> }

export function normalizeDirectFunctionInput(input: DirectFunctionInput): NormalizedDirectInput {
  if (input instanceof $ZodObject) {
    return {
      zodSchema: input,
      convexArgs: zodToConvexFields(getObjectShape(input))
    }
  }

  if (input instanceof $ZodType) {
    return {
      zodSchema: z.object({ value: input as any }),
      convexArgs: { value: zodToConvex(input as any) }
    }
  }

  return {
    argsShape: input,
    convexArgs: zodToConvexFields(input)
  }
}

export function normalizeCustomArgsValidator(args: ZodValidator | $ZodObject): {
  argsValidator: ZodValidator
  argsSchema: $ZodObject | undefined
} {
  if (args instanceof $ZodType) {
    if (args instanceof $ZodObject) {
      return {
        argsSchema: args as unknown as $ZodObject,
        argsValidator: args._zod.def.shape as any
      }
    }
    throw new Error(
      'Unsupported non-object Zod schema for args; please provide an args schema using z.object({...}), e.g. z.object({ foo: z.string() })'
    )
  }

  // User passed a raw shape — don't eagerly build z.object(args) here. The
  // wrapper (custom.ts / wrappers.ts) builds it per request inside the
  // handler body, matching convex-helpers' pattern. This keeps ~25 KB per
  // function out of the retained push-time isolate.
  return {
    argsValidator: args,
    argsSchema: undefined
  }
}

export function createConvexReturnsValidator(
  schema?: $ZodType,
  options?: { skipCustomSchemas?: boolean; skipConvexValidation?: boolean }
): any {
  if (!schema || options?.skipConvexValidation) {
    return undefined
  }
  if (options?.skipCustomSchemas && containsCustom(schema)) {
    return undefined
  }
  return zodToConvex(schema)
}

export function assertFunctionSchemas(argsSchema: $ZodType, returnsSchema?: $ZodType): void {
  assertNoNativeZodDate(argsSchema, 'args')
  if (returnsSchema) {
    assertNoNativeZodDate(returnsSchema, 'returns')
  }
}

export function parseFunctionArgsOrThrow(zodSchema: $ZodType, argsObject: unknown): any {
  try {
    return zodParse(zodSchema, argsObject) as any
  } catch (e) {
    handleZodValidationError(e, 'args')
  }
}

export function parseObjectArgsOrThrow(
  argsSchema: $ZodObject,
  rawArgs: Record<string, unknown>
): Record<string, unknown> {
  const parsed = safeParse(argsSchema, rawArgs)
  if (!parsed.success) {
    handleZodValidationError(parsed.error, 'args')
  }
  return parsed.data as Record<string, unknown>
}

export async function runCustomizationInput(
  customInput: (ctx: unknown, args: unknown, extra?: unknown) => unknown,
  ctx: unknown,
  allArgs: Record<string, unknown>,
  inputArgs: Record<string, unknown>,
  extra: Record<string, unknown>
): Promise<CustomInputResult | undefined> {
  return (await customInput(
    ctx,
    // Cast justification: customInput expects ObjectType<CustomArgsValidator>, but pick()
    // returns Partial<T>. The cast is safe because inputArgs keys are derived from
    // CustomArgsValidator at the type level.
    pick(allArgs, Object.keys(inputArgs)) as any,
    extra
  )) as CustomInputResult | undefined
}

export function applyCustomizationResult(
  ctx: Record<string, unknown>,
  baseArgs: Record<string, unknown>,
  added?: CustomInputResult
): { finalCtx: Record<string, unknown>; finalArgs: Record<string, unknown> } {
  const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
  const addedArgs = added?.args ?? {}
  return {
    finalCtx,
    finalArgs: { ...baseArgs, ...addedArgs }
  }
}

export async function finalizeFunctionReturn(
  result: unknown,
  options?: {
    ctx?: Record<string, unknown>
    args?: Record<string, unknown>
    added?: CustomInputResult
    returns?: $ZodType
  }
): Promise<unknown> {
  if (options?.added?.onSuccess) {
    await options.added.onSuccess({
      ctx: options.ctx,
      args: options.args,
      result
    })
  }

  if (options?.returns) {
    const validated = validateReturns(options.returns, result)
    return stripUndefined(validated)
  }

  return stripUndefined(result)
}
