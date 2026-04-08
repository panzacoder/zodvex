import type { FilterBuilder } from 'convex/server'
import type { InferFilterBuilder, InferTableInfo } from 'zodvex/server'
import { zx } from 'zodvex'
import { zq } from './functions'
import schema from './schema'

// --- Inline filter — no manual generics ---
// Users table has createdAt: zx.date() — the filter accepts Date directly
export const recentUsers = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('users')
      .filter(q => q.gte(q.field('createdAt'), after))
      .collect()
  },
})

// --- Reusable helper with schema-derived type ---
type UsersFilter = InferFilterBuilder<typeof schema, 'users'>

const createdAfter = (q: UsersFilter, date: Date) =>
  q.gte(q.field('createdAt'), date)

export const recentUsersWithHelper = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('users')
      .filter(q => createdAfter(q, after))
      .collect()
  },
})

// --- Chained filters mixing legacy + decoded-aware ---
type UsersTableInfo = InferTableInfo<typeof schema, 'users'>

const hasName = (q: FilterBuilder<UsersTableInfo>) =>
  q.neq(q.field('name'), '')

export const namedRecentUsers = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('users')
      .filter(hasName)                                                // Convex-native overload
      .filter(q => q.gte(q.field('createdAt'), after))                // decoded-aware overload
      .collect()
  },
})
