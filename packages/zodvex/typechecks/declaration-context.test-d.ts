import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric
} from 'convex/server'
import { z } from 'zod'
import { type DeclarationContext, defineContext, initZodvex } from '../src/public/server'

const { zm, zim, zq, ziq, za, zia } = initZodvex(
  { __zodTableMap: {} },
  {
    query: queryGeneric,
    mutation: mutationGeneric,
    action: actionGeneric,
    internalQuery: internalQueryGeneric,
    internalMutation: internalMutationGeneric,
    internalAction: internalActionGeneric
  },
  { wrapDb: false }
)

type Selected<D> = D extends { helpers: readonly (infer K)[] } ? Extract<K, 'one' | 'two'> : never
type Helpers<D> = { helpers: { [K in Selected<D>]: () => string } }
interface HelperContext extends DeclarationContext {
  readonly context: Helpers<this['declaration']>
}
const context = defineContext<HelperContext>()(zm, {
  args: {},
  input: (_ctx, _args, _extra?: { helpers?: readonly ('one' | 'two')[] }) => ({
    ctx: { helpers: {} },
    args: {}
  })
})
const builder = zm.withContext(context)
builder({
  helpers: ['one'],
  args: z.object({ name: z.string() }),
  returns: z.string(),
  handler: (ctx, args) => {
    const name: string = args.name
    // @ts-expect-error Unselected helper is unavailable.
    ctx.helpers.two()
    return ctx.helpers.one() + name
  }
})
builder({
  args: {},
  returns: z.null(),
  handler: ctx => {
    // @ts-expect-error Helpers must be declared.
    ctx.helpers.one()
    return null
  }
})
builder({
  // @ts-expect-error Invalid declaration options are rejected.
  helpers: ['three'],
  args: {},
  returns: z.null(),
  handler: () => null
})

const bare = builder(ctx => {
  // @ts-expect-error Function-only definitions have no declaration options.
  ctx.helpers.one()
  return 'ok'
})
void bare

import type { RegisteredAction, RegisteredMutation, RegisteredQuery } from 'convex/server'

interface DoubleContext extends DeclarationContext {
  readonly context: { helpers: { double: (n: number) => number } }
}
const codecContext = defineContext<DoubleContext>()(zim, {
  args: { factor: z.number() },
  input: (_ctx, { factor }, _extra?: { helpers?: readonly 'double'[] }) => ({
    ctx: { helpers: { double: (n: number) => n * 2 } },
    args: { factor }
  })
})

const internal = zim.withContext(codecContext)({
  helpers: ['double'],
  args: { value: z.number() },
  returns: z.number(),
  handler: (ctx, { factor, value }) => ctx.helpers.double(value) * factor
})
const internalRegistration: RegisteredMutation<
  'internal',
  { factor: number; value: number },
  number
> = internal
const publicRegistration: RegisteredMutation<'public', { name: string }, string> = builder({
  helpers: ['one'],
  args: { name: z.string() },
  returns: z.string(),
  handler: (ctx, { name }) => ctx.helpers.one() + name
})
const queryContext = defineContext<HelperContext>()(zq, {
  args: {},
  input: (_ctx, _args, _extra?: { helpers?: readonly ('one' | 'two')[] }) => ({
    ctx: { helpers: {} }
  })
})
const query: RegisteredQuery<'public', Record<string, never>, string> = zq.withContext(
  queryContext
)({
  helpers: ['one'],
  args: {},
  returns: z.string(),
  handler: ctx => ctx.helpers.one()
})
const internalQuery: RegisteredQuery<'internal', Record<string, never>, string> = ziq.withContext(
  queryContext
)({
  helpers: ['two'],
  args: {},
  returns: z.string(),
  handler: ctx => ctx.helpers.two()
})
const actionContext = defineContext<HelperContext>()(za, {
  args: {},
  input: (_ctx, _args, _extra?: { helpers?: readonly ('one' | 'two')[] }) => ({
    ctx: { helpers: {} }
  })
})
const action: RegisteredAction<'public', Record<string, never>, string> = za.withContext(
  actionContext
)({
  helpers: ['one'],
  args: {},
  returns: z.string(),
  handler: ctx => ctx.helpers.one()
})
const internalAction: RegisteredAction<'internal', Record<string, never>, string> = zia.withContext(
  actionContext
)({
  helpers: ['two'],
  args: {},
  returns: z.string(),
  handler: ctx => ctx.helpers.two()
})
void [internalRegistration, publicRegistration, query, internalQuery, action, internalAction]

// @ts-expect-error Registration validation must not return a promise.
zm.withContext({ validateDeclaration: async () => undefined })

import { composeContexts } from '../src/public/server'

type Flags<D> = { flags: D extends { flag: infer F } ? F : never }
interface FlagContext extends DeclarationContext {
  readonly context: Flags<this['declaration']>
}
const flags = defineContext<FlagContext>()(context, {
  args: {},
  input: (_ctx, _args, extra?: { flag?: 'enabled' | 'disabled' }) => ({
    ctx: { flags: extra?.flag }
  })
})
const composed = composeContexts(context, flags)
zm.withContext(composed)({
  helpers: ['one'],
  flag: 'enabled',
  args: {},
  returns: z.string(),
  handler: ctx => {
    const flag: 'enabled' = ctx.flags
    // @ts-expect-error Composition must preserve selected method narrowing.
    ctx.helpers.two()
    return ctx.helpers.one() + flag
  }
})
const replacement = defineContext(composed, {
  contextMode: 'replace',
  args: {},
  input: () => ({ ctx: { safe: true } })
})
zm.withContext(composeContexts(composed, replacement))({
  args: {},
  returns: z.boolean(),
  handler: ctx => {
    // @ts-expect-error Replacing context removes inherited database authority.
    ctx.db
    // @ts-expect-error Replacing context also removes prior declaration-dependent fields.
    ctx.helpers
    return ctx.safe
  }
})
const requiresFlags = defineContext(flags, {
  args: {},
  input: ctx => ({ ctx: { enabled: ctx.flags === 'enabled' } })
})
// @ts-expect-error A dependent context cannot run before the context supplying its input.
composeContexts(context, requiresFlags)

const overwriteHelpers = defineContext(context, {
  args: {},
  input: () => ({ ctx: { helpers: 'replaced' as const } })
})
zm.withContext(composeContexts(context, overwriteHelpers))({
  helpers: ['one'],
  args: {},
  returns: z.string(),
  handler: ctx => {
    const replaced: 'replaced' = ctx.helpers
    return replaced
  }
})
const emptyReplacement = zm.withContext({ contextMode: 'replace' })
emptyReplacement({
  args: {},
  returns: z.null(),
  handler: ctx => {
    // @ts-expect-error A replacement without input exposes no ambient database.
    ctx.db.query('items')
    return null
  }
})

const ordinaryInjection = zim.withContext({ input: () => ({ ctx: {}, args: { factor: 2 } }) })
ordinaryInjection({
  args: { value: z.number() },
  returns: z.number(),
  handler: (_ctx, args) => args.value * args.factor
})

zm.withContext(composeContexts(context))({
  helpers: ['one'],
  handler: ctx => ctx.helpers.one()
})
const plainContext = defineContext(zm, { input: () => ({ ctx: { label: 'hello' } }) })
zm.withContext(composeContexts(plainContext))({ handler: ctx => ctx.label.toUpperCase() })

builder({ handler: ctx => Object.keys(ctx.helpers).length })

import { applyCustomizationResult } from '../src/internal/functions/contracts'

const replacedContext = applyCustomizationResult(
  { secret: 'hidden' },
  {},
  {
    replaceContext: true as const,
    ctx: { visible: true }
  }
)
// @ts-expect-error Runtime replacement removes the original property.
replacedContext.finalCtx.secret
const visible: boolean = replacedContext.finalCtx.visible
void visible
