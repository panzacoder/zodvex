import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric
} from 'convex/server'
import { z } from 'zod'
import * as mini from 'zod/mini'
import { initZodvex } from '../src/internal/functions/init'
import type { Equal, Expect } from './test-helpers'

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

{
  const customized = builders.zq.withContext({
    input: () => ({ ctx: {}, args: { count: 'replacement' } })
  })
  customized({
    args: z.object({ count: z.number(), retained: z.boolean() }),
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, string>>
      type _Retained = Expect<Equal<typeof args.retained, boolean>>
      // @ts-expect-error Customization replaces count rather than intersecting it
      const _wrong: number = args.count
      return args.count.toUpperCase()
    }
  })
  customized({
    args: mini.object({ count: mini.number() }),
    handler: (_ctx, args) => {
      type _MiniCount = Expect<Equal<typeof args.count, string>>
      return args.count.toUpperCase()
    }
  })
}

{
  const customized = builders.zm.withContext({
    input: () => ({ ctx: {}, args: { count: 'replacement' } })
  })
  customized({
    args: z.object({ count: z.number(), retained: z.boolean() }),
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, string>>
      type _Retained = Expect<Equal<typeof args.retained, boolean>>
      // @ts-expect-error Customization replaces count rather than intersecting it
      const _wrong: number = args.count
      return args.count.toUpperCase()
    }
  })
  customized({
    args: mini.object({ count: mini.number() }),
    handler: (_ctx, args) => {
      type _MiniCount = Expect<Equal<typeof args.count, string>>
      return args.count.toUpperCase()
    }
  })
}

{
  const customized = builders.za.withContext({
    input: () => ({ ctx: {}, args: { count: 'replacement' } })
  })
  customized({
    args: z.object({ count: z.number(), retained: z.boolean() }),
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, string>>
      type _Retained = Expect<Equal<typeof args.retained, boolean>>
      // @ts-expect-error Customization replaces count rather than intersecting it
      const _wrong: number = args.count
      return args.count.toUpperCase()
    }
  })
  customized({
    args: mini.object({ count: mini.number() }),
    handler: (_ctx, args) => {
      type _MiniCount = Expect<Equal<typeof args.count, string>>
      return args.count.toUpperCase()
    }
  })
}

{
  const customized = builders.ziq.withContext({
    input: () => ({ ctx: {}, args: { count: 'replacement' } })
  })
  customized({
    args: z.object({ count: z.number(), retained: z.boolean() }),
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, string>>
      type _Retained = Expect<Equal<typeof args.retained, boolean>>
      // @ts-expect-error Customization replaces count rather than intersecting it
      const _wrong: number = args.count
      return args.count.toUpperCase()
    }
  })
  customized({
    args: mini.object({ count: mini.number() }),
    handler: (_ctx, args) => {
      type _MiniCount = Expect<Equal<typeof args.count, string>>
      return args.count.toUpperCase()
    }
  })
}

{
  const customized = builders.zim.withContext({
    input: () => ({ ctx: {}, args: { count: 'replacement' } })
  })
  customized({
    args: z.object({ count: z.number(), retained: z.boolean() }),
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, string>>
      type _Retained = Expect<Equal<typeof args.retained, boolean>>
      // @ts-expect-error Customization replaces count rather than intersecting it
      const _wrong: number = args.count
      return args.count.toUpperCase()
    }
  })
  customized({
    args: mini.object({ count: mini.number() }),
    handler: (_ctx, args) => {
      type _MiniCount = Expect<Equal<typeof args.count, string>>
      return args.count.toUpperCase()
    }
  })
}

{
  const customized = builders.zia.withContext({
    input: () => ({ ctx: {}, args: { count: 'replacement' } })
  })
  customized({
    args: z.object({ count: z.number(), retained: z.boolean() }),
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, string>>
      type _Retained = Expect<Equal<typeof args.retained, boolean>>
      // @ts-expect-error Customization replaces count rather than intersecting it
      const _wrong: number = args.count
      return args.count.toUpperCase()
    }
  })
  customized({
    args: mini.object({ count: mini.number() }),
    handler: (_ctx, args) => {
      type _MiniCount = Expect<Equal<typeof args.count, string>>
      return args.count.toUpperCase()
    }
  })
}
