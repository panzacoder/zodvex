import {
  actionGeneric,
  type FunctionVisibility,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric
} from 'convex/server'
import { z } from 'zod'
import * as mini from 'zod/mini'
import { defineContext, initZodvex, zCustomQuery, type ZodvexBuilder } from '../src/public/server'
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

// Optional patches must retain the original value, even when this particular
// customization returns a present string. Its declared return type is the contract.
// Use the shared context union (not any) so auth and argument assertions remain precise.
function checkOptionalPatch<
  Kind extends 'query' | 'mutation' | 'action',
  Visibility extends FunctionVisibility
>(
  builder: ZodvexBuilder<
    Kind,
    {},
    | GenericQueryCtx<GenericDataModel>
    | GenericMutationCtx<GenericDataModel>
    | GenericActionCtx<GenericDataModel>,
    Visibility
  >
) {
  for (const patch of [{}, { count: 'replacement' }, { count: undefined }]) {
    const customized = builder.withContext({
      input: (): { ctx: {}; args: { count?: string; extra?: boolean } } => ({
        ctx: {},
        args: patch
      })
    })
    for (const schema of [
      z.object({ count: z.number(), retained: z.boolean() }),
      mini.object({ count: mini.number(), retained: mini.boolean() })
    ]) {
      customized({
        args: schema,
        handler: (_ctx, args) => {
          type _Count = Expect<Equal<typeof args.count, number | string | undefined>>
          type _Retained = Expect<Equal<typeof args.retained, boolean>>
          type _Extra = Expect<Equal<typeof args.extra, boolean | undefined>>
          // The base key stays required, although an explicit undefined can overwrite it.
          // @ts-expect-error The required count key cannot be omitted
          const _missing: typeof args = { retained: true }
          // @ts-expect-error An omitted replacement leaves a number, which has no toUpperCase
          args.count?.toUpperCase()
          return typeof args.count === 'string' ? args.count.toUpperCase() : args.count
        }
      })
    }
  }
  const optionalContext = builder.withContext({
    input: (): { ctx: { auth?: string }; args: {} } => ({ ctx: {}, args: {} })
  })
  optionalContext({
    args: z.object({}),
    handler: ctx => {
      type _Auth = Expect<Equal<typeof ctx.auth, import('convex/server').Auth | string | undefined>>
      // @ts-expect-error Omitted auth replacement retains the original auth object
      ctx.auth?.toUpperCase()
      return null
    }
  })
  const requiredContext = builder.withContext({
    input: () => ({ ctx: { auth: 'replacement' }, args: {} })
  })
  requiredContext({
    handler: ctx => {
      type _Auth = Expect<Equal<typeof ctx.auth, string>>
      return ctx.auth.toUpperCase()
    }
  })
}
checkOptionalPatch(builders.zq)
checkOptionalPatch(builders.zm)
checkOptionalPatch(builders.za)
checkOptionalPatch(builders.ziq)
checkOptionalPatch(builders.zim)
checkOptionalPatch(builders.zia)

// Reusable and legacy customizations share the same handler contract.
const reusable = defineContext(builders.zq, {
  input: (): { ctx: {}; args: { count?: string } } => ({ ctx: {}, args: {} })
})
for (const custom of [
  builders.zq.withContext(reusable),
  zCustomQuery(queryGeneric, {
    args: {},
    input: (): { ctx: {}; args: { count?: string } } => ({ ctx: {}, args: {} })
  })
]) {
  custom({
    args: { count: z.number() },
    handler: (_ctx, args) => {
      type _Count = Expect<Equal<typeof args.count, number | string | undefined>>
      return args.count
    }
  })
}

// Interfaces need no string index signature to describe a customization patch.
interface RequiredArgsPatch {
  count: string
}
interface OptionalArgsPatch {
  count?: string
}
builders.zq.withContext({
  input: (): { ctx: {}; args: RequiredArgsPatch } => ({ ctx: {}, args: { count: 'replacement' } })
})({
  args: z.object({ count: z.number() }),
  handler: (_ctx, args) => {
    type _Count = Expect<Equal<typeof args.count, string>>
    return args.count.toUpperCase()
  }
})
builders.zq.withContext({
  input: (): { ctx: {}; args: OptionalArgsPatch } => ({ ctx: {}, args: {} })
})({
  args: z.object({ count: z.number() }),
  handler: (_ctx, args) => {
    type _Count = Expect<Equal<typeof args.count, number | string | undefined>>
    return args.count
  }
})
