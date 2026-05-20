import { z } from 'zod/mini'
import { zx } from 'zodvex/mini'
import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_zodvex/server'
import { zq, zm } from './functions'
import { TaskModel } from './models/task'
import { zDuration } from './codecs'

/**
 * Read-only helper typed as `QueryCtx`. Used by both `get` (a query) and
 * `complete` (a mutation) below. Demonstrates the native Convex idiom of
 * narrowing `MutationCtx → QueryCtx` for read-only call sites — works
 * out of the box as of 0.7.2 (see #64).
 */
async function getTaskOrThrow(ctx: QueryCtx, id: Id<'tasks'>) {
  const task = await ctx.db.get(id)
  if (!task) throw new Error(`task ${id} not found`)
  return task
}

export const get = zq({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: z.nullable(TaskModel.schema.doc),
})

export const list = zq({
  args: {
    status: z.optional(z.enum(['todo', 'in_progress', 'done'])),
    ownerId: z.optional(zx.id('users')),
    paginationOpts: z.object({
      numItems: z.number(),
      cursor: z.nullable(z.string()),
    }),
  },
  handler: async (ctx, { status, ownerId, paginationOpts }) => {
    const baseQuery = ctx.db.query('tasks')
    const q = ownerId
      ? baseQuery.withIndex('by_owner', (idx) => idx.eq('ownerId', ownerId))
      : status
        ? baseQuery.withIndex('by_status', (idx) => idx.eq('status', status))
        : baseQuery

    return await q.order('desc').paginate(paginationOpts)
  },
  returns: TaskModel.schema.paginatedDoc,
})

export const listByCreated = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('tasks')
      .withIndex('by_created', (q) => q.gte('createdAt', after))
      .collect()
  },
  returns: z.array(TaskModel.schema.doc),
})

export const create = zm({
  args: {
    title: z.string(),
    description: z.optional(z.string()),
    status: z.optional(z.enum(['todo', 'in_progress', 'done'])),
    priority: z.optional(z.nullable(z.enum(['low', 'medium', 'high']))),
    ownerId: zx.id('users'),
    assigneeId: z.optional(zx.id('users')),
    dueDate: z.optional(zx.date()),
    estimate: z.optional(zDuration),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('tasks', {
      ...args,
      status: args.status ?? 'todo',
      priority: args.priority ?? null,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('tasks'),
})

export const update = zm({
  args: {
    id: zx.id('tasks'),
    title: z.optional(z.string()),
    description: z.optional(z.string()),
    status: z.optional(z.enum(['todo', 'in_progress', 'done'])),
    priority: z.optional(z.nullable(z.enum(['low', 'medium', 'high']))),
    assigneeId: z.optional(zx.id('users')),
    dueDate: z.optional(zx.date()),
    estimate: z.optional(zDuration),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  },
})

export const complete = zm({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    // Calls a QueryCtx-typed helper from a mutation handler. Pre-0.7.2 this
    // would fail typecheck with "Property 'db' is private in type
    // 'ZodvexDatabaseWriter' but not in type 'ZodvexDatabaseReader'."
    // (#64). After the writer-extends-reader refactor it's the idiomatic
    // Convex pattern.
    await getTaskOrThrow(ctx, id)
    await ctx.db.patch(id, {
      status: 'done' as const,
      completedAt: new Date(),
    })
  },
})
