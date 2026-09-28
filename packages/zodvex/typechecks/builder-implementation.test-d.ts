import { queryGeneric } from 'convex/server'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import {
  customFnBuilder,
  zCustomAction,
  zCustomMutation
} from '../src/internal/functions/customFunctions'
import type { Equal, Expect } from './test-helpers'

const query = customFnBuilder(queryGeneric, NoOp)
query({
  args: z.object({
    at: z.codec(z.string(), z.date(), {
      decode: value => new Date(value),
      encode: value => value.toISOString()
    })
  }),
  handler: (_ctx, args) => {
    type _Decoded = Expect<Equal<typeof args.at, Date>>
    // @ts-expect-error The implementation must preserve decoded args, not accept wire values
    const _wire: string = args.at
    // @ts-expect-error The implementation must not invent schema properties
    args.missing
    return args.at
  }
})

// @ts-expect-error A registration factory must return a registered function, not a primitive
customFnBuilder(() => 123, NoOp)

query({
  args: { value: z.number() },
  returns: z.number(),
  // @ts-expect-error The implementation must enforce the declared decoded return
  handler: () => 'wrong'
})
query({
  handler: ctx => {
    ctx.db.query('anyTable')
    // @ts-expect-error Query handlers have no mutation writer
    ctx.db.insert('anyTable', {})
    // @ts-expect-error Raw query context has no invented property
    ctx.missing
  }
})
