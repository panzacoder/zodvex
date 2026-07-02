import { query } from '../../_convex-stubs'

/** Explicit desc over the default (creation-time) index → { desc, byCreationTime: true } */
export const listDesc = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').order('desc').collect()
  }
})

/** No .order() call → Convex defaults to asc → { asc, byCreationTime: true } */
export const listDefault = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect()
  }
})

/** .paginate() and .take() are list-producing terminators too */
export const paginatedDesc = query({
  handler: async (ctx, args: { paginationOpts: any }) => {
    return await ctx.db.query('tasks').order('desc').paginate(args.paginationOpts)
  }
})

export const recentTake = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').order('desc').take(20)
  }
})

/** .filter() preserves ordering — must not spoil extraction */
export const filteredDesc = query({
  handler: async (ctx) => {
    return await ctx.db
      .query('tasks')
      .order('desc')
      .filter((q) => q)
      .collect()
  }
})

/** Custom index → ordering recorded but byCreationTime false (placement unknowable) */
export const indexedDesc = query({
  handler: async (ctx) => {
    return await ctx.db
      .query('tasks')
      .withIndex('by_status', (q) => q)
      .order('desc')
      .collect()
  }
})

/** Single-doc terminators produce no ordering entry (and don't invalidate others) */
export const singleOnly = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').first()
  }
})

/** Chain broken by a variable assignment → inconclusive → no entry */
export const brokenChain = query({
  handler: async (ctx, args: { byStatus?: boolean }) => {
    const base = ctx.db.query('tasks')
    const q = args.byStatus ? base.withIndex('by_status', (s) => s) : base
    return await q.order('desc').collect()
  }
})

/** Two confident chains with conflicting directions → no entry for that table */
export const conflicting = query({
  handler: async (ctx) => {
    const a = await ctx.db.query('tasks').order('desc').collect()
    const b = await ctx.db.query('tasks').order('asc').collect()
    return [a, b]
  }
})

/** Dynamic order argument → inconclusive → no entry */
export const dynamicOrder = query({
  handler: async (ctx, args: { dir: 'asc' | 'desc' }) => {
    return await ctx.db.query('tasks').order(args.dir).collect()
  }
})

/** Search index → relevance-ordered, no placement semantics → no entry */
export const searched = query({
  handler: async (ctx) => {
    return await ctx.db
      .query('tasks')
      .withSearchIndex('search_title', (q) => q)
      .collect()
  }
})

/** Orderings are per-table: two tables, each with its own confident chain */
export const multiTable = query({
  handler: async (ctx) => {
    const tasks = await ctx.db.query('tasks').order('desc').collect()
    const users = await ctx.db.query('users').collect()
    return { tasks, users }
  }
})

/** A single+list mix on one table: the list chain's ordering survives */
export const mixedShapes = query({
  handler: async (ctx) => {
    const newest = await ctx.db.query('tasks').order('desc').first()
    const all = await ctx.db.query('tasks').order('desc').collect()
    return { newest, all }
  }
})
