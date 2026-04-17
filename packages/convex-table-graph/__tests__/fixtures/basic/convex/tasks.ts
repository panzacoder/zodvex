import { mutation, query } from '../../_convex-stubs'

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect()
  }
})

export const create = mutation({
  handler: async (ctx, args: { title: string }) => {
    return await ctx.db.insert('tasks', { title: args.title })
  }
})

export const listFirst = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').first()
  }
})
