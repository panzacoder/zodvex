import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric
} from 'convex/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { initZodvex } from '../src/public/server'

const builders = initZodvex(
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

describe.each(Object.entries(builders))('%s customization patches', (_name, builder) => {
  it.each([
    { patch: {}, expected: 42 },
    { patch: { count: 'replacement' }, expected: 'replacement' },
    { patch: { count: undefined }, expected: undefined }
  ])('preserves runtime spread behavior for $patch', async ({ patch, expected }) => {
    const customized = builder.withContext({
      input: (): { ctx: { auth?: string }; args: { count?: string } } => ({
        ctx: {},
        args: patch
      })
    })
    const fn = customized({
      args: z.object({ count: z.number() }),
      handler: (ctx, args) => ({ count: args.count, auth: ctx.auth })
    })
    // Convex exposes _handler at runtime for local invocation, outside its public type.
    const local = fn as unknown as {
      _handler: (ctx: object, args: { count: number }) => Promise<unknown>
    }
    const auth = { getUserIdentity: async () => null }
    expect(await local._handler({ auth }, { count: 42 })).toEqual({ count: expected, auth })
  })

  it('replaces required argument and context properties', async () => {
    const customized = builder.withContext({
      input: () => ({ ctx: { auth: 'replacement' }, args: { count: 'replacement' } })
    })
    const fn = customized({
      args: z.object({ count: z.number() }),
      handler: (ctx, args) => ({ count: args.count, auth: ctx.auth })
    })
    const local = fn as unknown as {
      _handler: (ctx: object, args: { count: number }) => Promise<unknown>
    }
    expect(await local._handler({ auth: {} }, { count: 42 })).toEqual({
      count: 'replacement',
      auth: 'replacement'
    })
  })
})
