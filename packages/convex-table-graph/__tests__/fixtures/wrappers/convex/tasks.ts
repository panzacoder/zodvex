import type { MutationCtx, QueryCtx } from '../../_convex-stubs'

// A project-specific wrapper around Convex's query/mutation builders.
// Common pattern in real codebases with zodvex or custom builders.
type ZodvexQueryConfig<H> = { args?: any; returns?: any; handler: H }

function zQuery<H extends (ctx: QueryCtx, args: any) => any>(config: ZodvexQueryConfig<H>): H {
  return config.handler
}

function zMutation<H extends (ctx: MutationCtx, args: any) => any>(
  config: ZodvexQueryConfig<H>
): H {
  return config.handler
}

export const list = zQuery({
  handler: async (ctx) => await ctx.db.query('tasks').collect()
})

export const create = zMutation({
  handler: async (ctx, args: { title: string }) => {
    return await ctx.db.insert('tasks', { title: args.title })
  }
})
