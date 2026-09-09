import { z } from 'zod'
import { getObjectShape, type ZodValidator, zodToConvex, zodToConvexFields } from '../mapping'
import { attachMeta } from '../meta'
import { assertNoNativeZodDate } from '../schema/dateGuards'
import { handleZodValidationError, validateReturns } from '../serverUtils'
import { pick } from '../shared/object'
import { stripUndefined } from '../stripUndefined'
import type { Overwrite } from '../types'
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
} from '../zod-core'

export type FunctionSchemaInput = $ZodType | Record<string, $ZodType> | undefined
export type DirectFunctionInput = $ZodType | Record<string, $ZodType>

export type CustomInputResult<Ctx = unknown> = {
  ctx?: Record<string, unknown>
  args?: Record<string, unknown>
  onSuccess?: (params: { ctx: Ctx; args: Record<string, unknown>; result: unknown }) => unknown
}

type NormalizedFunctionSchema<S extends FunctionSchemaInput> = S extends $ZodType
  ? S
  : S extends Record<string, $ZodType>
    ? z.ZodObject<S> // zod-ok: raw shapes are constructed using full Zod
    : undefined

export function normalizeFunctionSchema<S extends FunctionSchemaInput>(
  input: S
): NormalizedFunctionSchema<S> {
  const normalized = !input ? undefined : input instanceof $ZodType ? input : z.object(input)
  // The runtime branches exactly match the conditional type. TypeScript cannot
  // narrow the generic S itself when narrowing its value with instanceof.
  return normalized as NormalizedFunctionSchema<S>
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

export function normalizeDirectFunctionInput(input: DirectFunctionInput): {
  zodSchema: $ZodType
  convexArgs: Record<string, any>
} {
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
    zodSchema: z.object(input),
    convexArgs: zodToConvexFields(input)
  }
}

type NormalizedCustomArgs<S extends ZodValidator | $ZodObject> = S extends $ZodObject
  ? { argsValidator: S['_zod']['def']['shape']; argsSchema: S }
  : S extends ZodValidator
    ? { argsValidator: S; argsSchema: z.ZodObject<S> } // zod-ok: raw shape construction
    : never

export function normalizeCustomArgsValidator<S extends ZodValidator | $ZodObject>(
  args: S
): NormalizedCustomArgs<S> {
  let normalized: { argsValidator: ZodValidator; argsSchema: $ZodObject }
  if (args instanceof $ZodType) {
    if (args instanceof $ZodObject) {
      normalized = {
        argsSchema: args,
        argsValidator: args._zod.def.shape
      }
    } else {
      throw new Error(
        'Unsupported non-object Zod schema for args; please provide an args schema using z.object({...}), e.g. z.object({ foo: z.string() })'
      )
    }
  } else {
    const shape: ZodValidator = args
    normalized = {
      argsValidator: shape,
      argsSchema: z.object(shape)
    }
  }
  // Objects retain their original identity/configuration; raw shapes become
  // full Zod objects. This assertion connects those checked runtime branches
  // to S, which instanceof does not narrow at the generic type level.
  return normalized as NormalizedCustomArgs<S>
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

export function parseObjectArgsOrThrow<S extends $ZodObject>(
  argsSchema: S,
  rawArgs: Record<string, unknown>
): z.output<S> {
  const parsed = safeParse(argsSchema, rawArgs)
  if (!parsed.success) {
    handleZodValidationError(parsed.error, 'args')
  }
  return parsed.data
}

export async function runCustomizationInput<
  Ctx,
  Args,
  Extra,
  Result extends CustomInputResult<Ctx> | undefined
>(
  customInput: (ctx: Ctx, args: Args, extra: Extra) => Result | Promise<Result>,
  ctx: Ctx,
  allArgs: Record<string, unknown>,
  inputArgs: Record<string, unknown>,
  extra: Extra,
  argsSchema?: $ZodObject
): Promise<Result> {
  const picked = pick(allArgs, Object.keys(inputArgs))
  // #72: when the customization declared its args as zod, decode them (codec
  // transforms applied) before the customization's `input` runs — symmetric
  // with how consumer args are decoded via parseObjectArgsOrThrow.
  const customArgs = argsSchema ? parseObjectArgsOrThrow(argsSchema, picked) : picked
  // inputArgs selects the customization's declared keys. Zod declarations are
  // parsed here; legacy declarations were validated by Convex at registration.
  // This is the wire-to-decoded boundary whose Args type the caller supplies.
  return await customInput(ctx, customArgs as Args, extra)
}

type RequiredKeys<T> = {
  // biome-ignore lint/complexity/noBannedTypes: empty-object assignability detects optional keys
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]

// Optional patch keys may be absent (retaining a base value) or explicitly
// undefined (overwriting it). Preserve both possibilities and key optionality.
type SpreadPatch<Base, Patch> = Omit<Base, keyof Patch> &
  Pick<Patch, RequiredKeys<Patch>> & {
    [K in keyof Base as K extends keyof Patch
      ? K extends RequiredKeys<Patch>
        ? never
        : K
      : never]: Base[K] | Patch[K & keyof Patch]
  } & {
    [K in keyof Patch as K extends keyof Base
      ? never
      : K extends RequiredKeys<Patch>
        ? never
        : K]?: Patch[K]
  }

type MergePatch<Base, Patch> =
  Patch extends Record<string, unknown>
    ? Patch extends Required<Patch>
      ? Overwrite<Base, Patch>
      : SpreadPatch<Base, Patch>
    : Base

type ResultPatch<Added, Key extends 'ctx' | 'args'> = Added extends undefined
  ? undefined
  : Key extends keyof Added
    ? Added[Key]
    : undefined

type AddedResult<Input extends unknown[]> = Input extends [infer Added] ? Added : undefined

export function applyCustomizationResult<
  Ctx extends Record<string, unknown>,
  Args extends Record<string, unknown>,
  Input extends [] | [added: Pick<CustomInputResult, 'ctx' | 'args'> | undefined]
>(
  ctx: Ctx,
  baseArgs: Args,
  ...customization: Input
): {
  finalCtx: MergePatch<Ctx, ResultPatch<AddedResult<Input>, 'ctx'>>
  finalArgs: MergePatch<Args, ResultPatch<AddedResult<Input>, 'args'>>
} {
  const added = customization[0]
  const finalCtx = { ...ctx, ...(added?.ctx ?? {}) }
  const addedArgs = added?.args ?? {}
  // Generic object spread is inferred as intersection by TypeScript, whereas
  // runtime spread overwrites keys. The mapped types model that operation,
  // including absent results, absent patches, and optional individual keys.
  return {
    finalCtx,
    finalArgs: { ...baseArgs, ...addedArgs }
  } as {
    finalCtx: MergePatch<Ctx, ResultPatch<AddedResult<Input>, 'ctx'>>
    finalArgs: MergePatch<Args, ResultPatch<AddedResult<Input>, 'args'>>
  }
}

export async function finalizeFunctionReturn<Ctx>(
  result: unknown,
  options?:
    | {
        ctx: Ctx
        args: Record<string, unknown>
        added?: CustomInputResult<Ctx>
        returns?: $ZodType
      }
    | {
        ctx?: undefined
        args?: Record<string, unknown>
        added?: undefined
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
