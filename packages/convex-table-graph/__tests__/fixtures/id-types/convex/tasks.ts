import type { Id } from '../../_convex-stubs'
import { mutation } from '../../_convex-stubs'

export const archive = mutation({
  handler: async (ctx, args: { taskId: Id<'tasks'> }) => {
    await ctx.db.patch(args.taskId, { archived: true })
  }
})

export const remove = mutation({
  handler: async (ctx, args: { taskId: Id<'tasks'> }) => {
    await ctx.db.delete(args.taskId)
  }
})

export const replaceDoc = mutation({
  handler: async (ctx, args: { taskId: Id<'tasks'>; title: string }) => {
    await ctx.db.replace(args.taskId, { title: args.title })
  }
})

export const fetchById = mutation({
  handler: async (ctx, args: { taskId: Id<'tasks'> }) => {
    const doc = await ctx.db.get(args.taskId)
    return doc
  }
})
