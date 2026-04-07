import { z } from 'zod'
import { zodvexCodec } from '../src/codec'
import type { ZodvexCodec } from '../src/types'
import { type FullZodvexCodec, zx } from '../src/zx'
import type { Equal, Expect } from './test-helpers'

// --- Test 1: Standard codec (zx.date pattern) infers correctly ---
const dateCodec = zx.codec(
  z.number(),
  z.custom<Date>((val) => val instanceof Date),
  {
    decode: (wire) => new Date(wire),
    encode: (date) => date.getTime(),
  }
)
type _DateCodec = Expect<
  Equal<typeof dateCodec, FullZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>>
>

// --- Test 2: zodvexCodec() also infers correctly ---
const innerCodec = zodvexCodec(
  z.number(),
  z.custom<Date>((val) => val instanceof Date),
  {
    decode: (wire) => new Date(wire),
    encode: (date) => date.getTime(),
  }
)
type _InnerCodec = Expect<Equal<typeof innerCodec, ZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>>>

// --- Test 3: Generic factory with unresolved T ---
// When T is unresolved, z.output<W> can't be computed.
// The caller annotates transform params and WO/RI are inferred from those.
function genericCodecFactory<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({ value: inner, tag: z.literal('wrapped') })

  return zx.codec(wireSchema, z.custom<{ unwrapped: z.output<T> }>(() => true), {
    decode: (wire: { value: z.output<T>; tag: 'wrapped' }) => ({
      unwrapped: wire.value,
    }),
    encode: (runtime: { unwrapped: z.output<T> }) => ({
      value: runtime.unwrapped,
      tag: 'wrapped' as const,
    }),
  })
}

// The factory should return ZodvexCodec with the schema types preserved
const stringWrapped = genericCodecFactory(z.string())
type _FactoryReturn = Expect<
  Equal<
    typeof stringWrapped,
    FullZodvexCodec<
      z.ZodObject<{ value: z.ZodString; tag: z.ZodLiteral<'wrapped'> }>,
      z.ZodCustom<{ unwrapped: string }, { unwrapped: string }>
    >
  >
>
