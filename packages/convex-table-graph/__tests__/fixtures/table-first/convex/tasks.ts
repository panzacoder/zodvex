import type { Id } from '../../_convex-stubs'
import { mutation, query } from '../../_convex-stubs'

// Table-name-first overloads (zodvex codec db / newer convex):
// db.get('tasks', id) instead of db.get(id).

export const getTask = query({
  handler: async (ctx, args: { id: Id<'tasks'> }) => {
    return await ctx.db.get('tasks', args.id)
  }
})

export const update = mutation({
  handler: async (ctx, args: { id: Id<'tasks'>; title: string }) => {
    await ctx.db.patch('tasks', args.id, { title: args.title })
  }
})

export const replaceDoc = mutation({
  handler: async (ctx, args: { id: Id<'tasks'>; title: string }) => {
    await ctx.db.replace('tasks', args.id, { title: args.title })
  }
})

export const remove = mutation({
  handler: async (ctx, args: { id: Id<'tasks'> }) => {
    await ctx.db.delete('tasks', args.id)
  }
})

// Id-first overload must keep working side by side.
export const removeById = mutation({
  handler: async (ctx, args: { id: Id<'tasks'> }) => {
    await ctx.db.delete(args.id)
  }
})
