import type { Id } from '../../_convex-stubs'
import { mutation } from '../../_convex-stubs'
import { ensure, getX, upsert } from './helpers'

// Literal table name propagates into a parametric helper.
export const touch = mutation({
  handler: async (ctx, args: { id: Id<'tasks'> }) => {
    await getX(ctx.db, 'tasks', args.id)
  }
})

// The same helper called with two different tables must record both.
export const touchTwo = mutation({
  handler: async (ctx, args: { taskId: Id<'tasks'>; userId: Id<'users'> }) => {
    await getX(ctx.db, 'tasks', args.taskId)
    await getX(ctx.db, 'users', args.userId)
  }
})

// Helper that reads, patches, and inserts on a parametric table.
export const save = mutation({
  handler: async (ctx, args: { title: string }) => {
    await upsert(ctx.db, 'tasks', { title: args.title })
  }
})

// The literal survives a two-hop helper chain.
export const touchDeep = mutation({
  handler: async (ctx, args: { id: Id<'tasks'> }) => {
    await ensure(ctx.db, 'tasks', args.id)
  }
})
