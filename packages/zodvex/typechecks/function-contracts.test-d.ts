import { z } from 'zod'
import * as mini from 'zod/mini'
import { parseObjectArgsOrThrow } from '../src/internal/functionContracts'
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
