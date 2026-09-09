import { type GenericDataModel, type GenericQueryCtx, queryGeneric } from 'convex/server'
import { z } from 'zod'
import { zCustomMutation, zCustomQuery } from '../src/internal/functions/customFunctions'
import { composeCustomizations, createZodvexBuilder } from '../src/internal/functions/init'
import type { Equal, Expect } from './test-helpers'

const codec = {
  args: {},
  input: (_ctx: GenericQueryCtx<GenericDataModel>, _args: Record<string, never>) => ({
    ctx: { identity: 'user' },
    args: {}
  })
}
const composed = composeCustomizations(codec, {
  args: { token: z.string() },
  input: (ctx, args) => {
    type _Ctx = Expect<Equal<typeof ctx.identity, string>>
    type _Args = Expect<Equal<typeof args.token, string>>
    // @ts-expect-error Composition must retain the actual codec context
    ctx.missing
    // @ts-expect-error Customization args are checked
    const _unknownArg: string = args.missing
    return { ctx: { identity: ctx.identity.length }, args: { token: new Date() } }
  }
})
const composedResult = null as unknown as Awaited<ReturnType<typeof composed.input>>
// Required user input must retain the produced argument type.
if ('token' in composedResult.args) {
  type _ResultArgs = Expect<Equal<typeof composedResult.args.token, Date>>
}

const builder = createZodvexBuilder(queryGeneric, codec, zCustomQuery)
builder({
  args: { n: z.number() },
  handler: (ctx, args) => {
    type _Ctx = Expect<Equal<typeof ctx.identity, string>>
    type _Args = Expect<Equal<typeof args.n, number>>
    // @ts-expect-error Factory must not return an unchecked callable
    const _unknownArg: string = args.missing
    return args.n
  }
})

// @ts-expect-error A query factory must not register through a mutation adapter
createZodvexBuilder(queryGeneric, codec, zCustomMutation)
const customized = builder.withContext({
  args: { token: z.string() },
  input: (ctx, args) => {
    type _Ctx = Expect<Equal<typeof ctx.identity, string>>
    type _Args = Expect<Equal<typeof args.token, string>>
    return { ctx: { authorized: true }, args: { when: new Date() } }
  }
})
customized({
  args: { n: z.number() },
  handler: (ctx, args) => {
    type _Authorized = Expect<Equal<typeof ctx.authorized, boolean>>
    type _Date = Expect<Equal<typeof args.when, Date>>
    // @ts-expect-error Produced customization args have precise runtime types
    const _wire: string = args.when
    return args.n
  }
})
