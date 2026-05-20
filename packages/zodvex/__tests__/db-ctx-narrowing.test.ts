import type { GenericDataModel } from 'convex/server'
import { describe, expectTypeOf, it } from 'vitest'
import { ZodvexDatabaseReader, ZodvexDatabaseWriter } from '../src/internal/db'
import type { ZodvexMutationCtx, ZodvexQueryCtx } from '../src/internal/init'

// Regression coverage for #64. Before the writer-extends-reader refactor,
// `ZodvexDatabaseWriter` composed a `private reader` and re-exposed read
// methods by delegation. TypeScript's nominal-typing rule for classes-
// with-private-fields then blocked the writer from narrowing to the reader,
// breaking the native Convex idiom of typing read-only helpers as
// `ctx: QueryCtx` and calling them from mutations.

describe('ZodvexDatabaseWriter narrows to ZodvexDatabaseReader (#64)', () => {
  type DM = GenericDataModel

  it('class-level: Writer is assignable to Reader', () => {
    expectTypeOf<ZodvexDatabaseWriter<DM>>().toMatchTypeOf<ZodvexDatabaseReader<DM>>()
  })

  it('ctx-level: MutationCtx.db is assignable to QueryCtx.db', () => {
    expectTypeOf<ZodvexMutationCtx<DM>['db']>().toMatchTypeOf<ZodvexQueryCtx<DM>['db']>()
  })

  it('ctx-level: MutationCtx is assignable to QueryCtx', () => {
    expectTypeOf<ZodvexMutationCtx<DM>>().toMatchTypeOf<ZodvexQueryCtx<DM>>()
  })

  it('idiomatic Convex pattern: read-only helper typed as QueryCtx accepts MutationCtx', () => {
    // Defines a function that only reads (typed as QueryCtx). Calling it from
    // a mutation handler with MutationCtx should compile without a cast.
    function readOnly(_ctx: ZodvexQueryCtx<DM>) {
      // body intentionally empty — this is a type-level test
    }
    function mutationHandler(ctx: ZodvexMutationCtx<DM>) {
      readOnly(ctx) // ← compiles iff narrowing works
    }
    expectTypeOf(mutationHandler).toBeFunction()
    expectTypeOf(readOnly).toBeFunction()
  })
})
