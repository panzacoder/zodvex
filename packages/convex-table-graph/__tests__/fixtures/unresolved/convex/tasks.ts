import { mutation, query } from '../../_convex-stubs'

// Dynamic table name — cannot be statically resolved.
export const dynamicRead = query({
  handler: async (ctx, args: { tableName: string }) => {
    return await ctx.db.query(args.tableName).collect()
  }
})

// Well-formed query — should still analyze correctly even if earlier in the file
// there was something unresolvable.
export const goodRead = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect()
  }
})
