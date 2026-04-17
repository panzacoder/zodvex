import { mutation } from '../../_convex-stubs'
import { archiveTaskWithAudit, bulkInsertTasks, formatTitle, insertTask } from './helpers'

export const createViaHelper = mutation({
  handler: async (ctx, args: { title: string }) => {
    // Passes ctx.db to a helper — writes ["tasks"]
    await insertTask(ctx.db, formatTitle(args.title))
  }
})

export const archive = mutation({
  handler: async (ctx, args: { taskId: string }) => {
    // Passes whole ctx to a helper — reads ["tasks"], writes ["auditLog"]
    await archiveTaskWithAudit(ctx, args.taskId)
  }
})

export const bulk = mutation({
  handler: async (ctx, args: { titles: string[] }) => {
    // Two-hop: mutation -> bulkInsertTasks -> insertTask
    await bulkInsertTasks(ctx.db, args.titles)
  }
})
