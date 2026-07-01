import type { Id } from '../../_convex-stubs'
import { mutation, query } from '../../_convex-stubs'

// Concise arrow body where the db call IS the body expression (no braces).
export const fetchById = query({
  handler: async (ctx, args: { id: Id<'tasks'> }) => ctx.db.get(args.id)
})

// Concise body ending in a method chain — the db call is a descendant of the body.
export const list = query({
  handler: (ctx) => ctx.db.query('tasks').collect()
})

// Concise body on a mutation where the insert call is the body expression.
export const create = mutation({
  handler: (ctx, args: { title: string }) => ctx.db.insert('tasks', { title: args.title })
})
