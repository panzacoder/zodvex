import { z } from 'zod'
import * as mini from 'zod/mini'
import {
  applyCustomizationResult,
  finalizeFunctionReturn,
  normalizeCustomArgsValidator,
  normalizeFunctionSchema,
  parseObjectArgsOrThrow,
  runCustomizationInput
} from '../src/internal/functions/contracts'
import type { Equal, Expect } from './test-helpers'

const at = z.codec(z.string(), z.date(), {
  decode: value => new Date(value),
  encode: value => value.toISOString()
})
const full = parseObjectArgsOrThrow(z.object({ at, n: z.number().default(1) }), {})
type _Output = Expect<Equal<typeof full, { at: Date; n: number }>>
full.at.getTime()
// @ts-expect-error Decoded Date is not wire string
const _wire: string = full.at
// @ts-expect-error No unchecked keys
full.missing
const small = parseObjectArgsOrThrow(mini.object({ n: mini.number() }), {})
type _MiniOutput = Expect<Equal<typeof small, { n: number }>>
// @ts-expect-error Object parser rejects primitive schemas
parseObjectArgsOrThrow(z.number(), {})

const shape = { at, n: z.number().default(1) }
const normalizedShape = normalizeCustomArgsValidator(shape)
type _ShapeValidators = Expect<Equal<typeof normalizedShape.argsValidator, typeof shape>>
const normalizedOutput = parseObjectArgsOrThrow(normalizedShape.argsSchema, {})
type _NormalizedOutput = Expect<Equal<typeof normalizedOutput, { at: Date; n: number }>>
// @ts-expect-error Normalization must not introduce unchecked keys
normalizedOutput.missing

const strictSchema = z.strictObject(shape)
const normalizedObject = normalizeCustomArgsValidator(strictSchema)
type _ObjectIdentity = Expect<Equal<typeof normalizedObject.argsSchema, typeof strictSchema>>
type _ObjectValidators = Expect<Equal<typeof normalizedObject.argsValidator, typeof shape>>
const miniSchema = mini.looseObject({ n: mini.number() })
const normalizedMini = normalizeCustomArgsValidator(miniSchema)
type _MiniIdentity = Expect<Equal<typeof normalizedMini.argsSchema, typeof miniSchema>>
type _MiniNormalizedOutput = Expect<
  Equal<z.output<typeof normalizedMini.argsSchema>, mini.output<typeof miniSchema>>
>

const normalizedReturn = normalizeFunctionSchema(at)
type _ReturnIdentity = Expect<Equal<typeof normalizedReturn, typeof at>>
const normalizedReturnShape = normalizeFunctionSchema(shape)
type _ReturnShapeOutput = Expect<
  Equal<z.output<typeof normalizedReturnShape>, { at: Date; n: number }>
>
const normalizedMiniReturn = normalizeFunctionSchema(miniSchema)
type _MiniReturnIdentity = Expect<Equal<typeof normalizedMiniReturn, typeof miniSchema>>
const absentReturn = normalizeFunctionSchema(undefined)
type _AbsentReturn = Expect<Equal<typeof absentReturn, undefined>>
const optionalSchema = null as unknown as typeof strictSchema | undefined
const normalizedOptional = normalizeFunctionSchema(optionalSchema)
type _OptionalReturn = Expect<Equal<typeof normalizedOptional, typeof strictSchema | undefined>>

const merged = applyCustomizationResult(
  { auth: 'original', retained: true },
  { id: 'wire', retained: 1 },
  { ctx: { auth: 123 }, args: { id: new Date() } }
)
type _MergedContext = Expect<Equal<typeof merged.finalCtx.auth, number>>
type _MergedArgs = Expect<Equal<typeof merged.finalArgs.id, Date>>
type _RetainedArgs = Expect<Equal<typeof merged.finalArgs.retained, number>>
const unmodified = applyCustomizationResult({ auth: 'original' }, { id: 'wire' })
type _AbsentPatch = Expect<Equal<typeof unmodified.finalArgs, { id: string }>>
const possiblePatch = null as unknown as { args?: { id: Date } } | undefined
const maybeMerged = applyCustomizationResult({}, { id: 'wire' }, possiblePatch)
type _PossiblePatch = Expect<Equal<typeof maybeMerged.finalArgs.id, string | Date>>
const optionalKey = null as unknown as { args: { id?: Date; extra?: number } }
const optionalMerge = applyCustomizationResult({}, { id: 'wire' }, optionalKey)
type _OptionalKey = Expect<Equal<typeof optionalMerge.finalArgs.id, string | Date | undefined>>
type _OptionalNewKey = Expect<Equal<typeof optionalMerge.finalArgs.extra, number | undefined>>

const customInput = (
  ctx: { identity: string },
  args: { at: Date },
  extra: { enabled: boolean }
) => ({
  ctx: { identity: extra.enabled ? ctx.identity.length : 0 },
  args: { at: args.at },
  onSuccess: ({ ctx: original }: { ctx: { identity: string }; args: unknown; result: unknown }) => {
    original.identity.toUpperCase()
  }
})
const addedPromise = runCustomizationInput(
  customInput,
  { identity: 'user' },
  {},
  { at },
  { enabled: true },
  z.object({ at })
)
type _InputResult = Expect<Equal<Awaited<typeof addedPromise>, ReturnType<typeof customInput>>>
const finalized = finalizeFunctionReturn('result', {
  ctx: { identity: 'user' },
  args: { at: new Date() },
  added: customInput({ identity: 'user' }, { at: new Date() }, { enabled: true })
})
type _FinalizedWire = Expect<Equal<typeof finalized, Promise<unknown>>>
