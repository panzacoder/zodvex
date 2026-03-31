import { z } from 'zod/mini'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { TaskModel } from './models/task'
import { zDuration } from './codecs'

export const get = zq({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: TaskModel.schema.doc.nullable(),
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
    await ctx.db.patch(id, {
      status: 'done' as const,
      completedAt: new Date(),
    })
  },
})
