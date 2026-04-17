import { internalMutation, internalQuery, mutation, query } from '../../_convex-stubs'

export const publicList = query({
  handler: async (ctx) => await ctx.db.query('tasks').collect()
})

export const secretList = internalQuery({
  handler: async (ctx) => await ctx.db.query('tasks').collect()
})

export const publicInsert = mutation({
  handler: async (ctx, args: { title: string }) => {
    return await ctx.db.insert('tasks', { title: args.title })
  }
})

export const secretInsert = internalMutation({
  handler: async (ctx, args: { title: string }) => {
    return await ctx.db.insert('tasks', { title: args.title })
  }
})
