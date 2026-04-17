import { query } from '../../_convex-stubs'

export default query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect()
  }
})
