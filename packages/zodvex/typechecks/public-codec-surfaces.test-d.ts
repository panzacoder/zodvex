import type { ZodvexCodec as RootZodvexCodec } from '../src'
import { zx as rootZx } from '../src'
import type { ZodvexCodec as CoreCompatZodvexCodec } from '../src/core'
import type { ZodvexCodec as MiniZodvexCodec } from '../src/mini'
import { zx as miniZx } from '../src/mini'
import type { Equal, Expect } from './test-helpers'
import { z } from 'zod'
import { z as zm } from 'zod/mini'
import type { $ZodType, output as zoutput } from 'zod/v4/core'

type SensitiveStatus = 'full' | 'hidden'

type FullSensitiveWire<T extends z.ZodTypeAny> = z.ZodObject<{
  value: z.ZodNullable<T>
  status: z.ZodEnum<{ full: 'full'; hidden: 'hidden' }>
  reason: z.ZodOptional<z.ZodString>
  __sensitiveField: z.ZodOptional<z.ZodString>
}>

type FullSensitiveRuntime<T extends z.ZodTypeAny> = z.ZodObject<{
  value: z.ZodNullable<T>
  status: z.ZodEnum<{ full: 'full'; hidden: 'hidden' }>
  reason: z.ZodOptional<z.ZodString>
  __sensitiveField: z.ZodOptional<z.ZodString>
}>

type SensitiveCodec<T extends z.ZodTypeAny> = RootZodvexCodec<
  FullSensitiveWire<T>,
  FullSensitiveRuntime<T>
>

function sensitive<T extends z.ZodTypeAny>(inner: T): SensitiveCodec<T> {
  return rootZx.codec(
    z.object({
      value: inner.nullable(),
      status: z.enum(['full', 'hidden']),
      reason: z.string().optional(),
      __sensitiveField: z.string().optional()
    }),
    z.object({
      value: inner.nullable(),
      status: z.enum(['full', 'hidden']),
      reason: z.string().optional(),
      __sensitiveField: z.string().optional()
    }),
    {
      decode: wire => wire,
      encode: runtime => runtime
    }
  )
}

const sensitiveString = sensitive(z.string())
const sensitiveStringOptional = sensitiveString.optional()
const sensitiveStringParsed = sensitiveString.parse({
  value: 'ok',
  status: 'full' as SensitiveStatus
})

const acceptFullZodType = <T extends z.ZodTypeAny>(schema: T) => schema
acceptFullZodType(sensitiveString)

type _CoreCodecExtendsZodType = Expect<SensitiveCodec<z.ZodString> extends z.ZodTypeAny ? true : false>
type _CoreCompatAliasMatchesRoot = Expect<
  Equal<CoreCompatZodvexCodec<z.ZodString, z.ZodString>, RootZodvexCodec<z.ZodString, z.ZodString>>
>
type _CoreOptionalStillFullZod = Expect<
  Equal<typeof sensitiveStringOptional, z.ZodOptional<SensitiveCodec<z.ZodString>>>
>
type _CoreParsedStatus = Expect<Equal<typeof sensitiveStringParsed.status, SensitiveStatus>>

const miniSensitiveWire = zm.object({
  value: zm.nullable(zm.string()),
  status: zm.enum(['full', 'hidden']),
  reason: zm.optional(zm.string()),
  __sensitiveField: zm.optional(zm.string())
})

const miniSensitiveRuntime = zm.object({
  value: zm.nullable(zm.string()),
  status: zm.enum(['full', 'hidden']),
  reason: zm.optional(zm.string()),
  __sensitiveField: zm.optional(zm.string())
})

type MiniSensitiveCodec = MiniZodvexCodec<typeof miniSensitiveWire, typeof miniSensitiveRuntime>

const miniSensitiveString: MiniSensitiveCodec = miniZx.codec(
  miniSensitiveWire,
  miniSensitiveRuntime,
  {
    decode: wire => wire,
    encode: runtime => runtime
  }
)
const miniSensitiveStringOptional = zm.optional(miniSensitiveString)
type MiniSensitiveOutput = zoutput<typeof miniSensitiveString>

type _MiniCodecExtendsCoreZod = Expect<
  MiniSensitiveCodec extends MiniZodvexCodec<$ZodType, $ZodType> ? true : false
>
type _MiniOptionalWraps = Expect<
  typeof miniSensitiveStringOptional extends $ZodType ? true : false
>
type _MiniOutputStatus = Expect<Equal<MiniSensitiveOutput['status'], SensitiveStatus>>
