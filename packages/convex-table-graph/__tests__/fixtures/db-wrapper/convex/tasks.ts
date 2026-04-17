import type { DatabaseWriter, MutationCtx, QueryCtx } from '../../_convex-stubs'
import { mutation, query } from '../../_convex-stubs'

// Simulate zodvex's `withRules` pattern: a method on db that returns a db-like object.
declare module '../../_convex-stubs' {
  interface DatabaseReader {
    withRules: (rules: any) => DatabaseReader
  }
  interface DatabaseWriter {
    withRules: (rules: any) => DatabaseWriter
  }
}

export const listWithRules = query({
  handler: async (ctx) => {
    const secureDb = ctx.db.withRules({ ownerId: 'x' })
    return await secureDb.query('tasks').collect()
  }
})

export const updateWithRules = mutation({
  handler: async (ctx, args: { title: string }) => {
    const secureDb = ctx.db.withRules({ ownerId: 'x' })
    return await secureDb.insert('tasks', { title: args.title })
  }
})

// Two-step wrapper chain.
export const chainedWrappers = query({
  handler: async (ctx) => {
    const db1 = ctx.db.withRules({ a: 1 })
    const db2 = db1.withRules({ b: 2 })
    return await db2.query('tasks').collect()
  }
})
