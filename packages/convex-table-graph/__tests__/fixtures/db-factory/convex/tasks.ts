// @ts-nocheck — `stream-pkg` is intentionally unresolvable, simulating a real
// node_modules dependency (e.g. zodvex's zodvexStream) the analyzer can't follow.
import { fakeStream } from 'stream-pkg'
import { mutation, query } from '../../_convex-stubs'

// Chained use: the factory call is the receiver of .query().
export const listViaStream = query({
  handler: async (ctx) => {
    return await fakeStream(ctx.db, {}).query('tasks').collect()
  }
})

// Variable use: the factory result is stored, then queried.
export const listViaStreamVar = query({
  handler: async (ctx) => {
    const s = fakeStream(ctx.db, {})
    return await s.query('tasks').collect()
  }
})

// Mixed with a direct write in the same handler.
export const rotate = mutation({
  handler: async (ctx, args: { title: string }) => {
    const existing = await fakeStream(ctx.db, {}).query('tasks').collect()
    await ctx.db.insert('archive', { count: existing.length, title: args.title })
  }
})
