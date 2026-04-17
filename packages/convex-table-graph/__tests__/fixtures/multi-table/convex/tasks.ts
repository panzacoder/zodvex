import { mutation, query } from '../../_convex-stubs'

export const archive = mutation({
  handler: async (ctx, args: { title: string }) => {
    // Reads tasks, writes both tasks (implicitly via the pattern) and auditLog.
    const existing = await ctx.db.query('tasks').first()
    if (existing) {
      await ctx.db.insert('auditLog', { taskId: 'x', action: 'archive' })
    }
    await ctx.db.insert('tasks', { title: args.title })
  }
})

export const readTwoTables = query({
  handler: async (ctx) => {
    const tasks = await ctx.db.query('tasks').collect()
    const users = await ctx.db.query('users').collect()
    return { tasks, users }
  }
})
