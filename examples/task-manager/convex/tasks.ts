import { z } from 'zod'
import { zx, encodeDoc } from 'zodvex/core'
import { zq, zm } from './functions'
import { TaskModel } from './models/task'

export const get = zq({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: TaskModel.schema.doc.nullable(),
})

export const list = zq({
  args: {
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    ownerId: zx.id('users').optional(),
    paginationOpts: z.object({
      numItems: z.number(),
      cursor: z.string().nullable(),
    }),
  },
  handler: async (ctx, { status, ownerId, paginationOpts }) => {
    let q = ctx.db.query('tasks')

    if (ownerId) {
      q = q.withIndex('by_owner', (idx) => idx.eq('ownerId', ownerId))
    } else if (status) {
      q = q.withIndex('by_status', (idx) => idx.eq('status', status))
    }

    const result = await q.order('desc').paginate(paginationOpts)
    // Re-encode decoded docs back to wire format for Convex serialization
    return {
      ...result,
      page: result.page.map((doc: any) => encodeDoc(TaskModel.schema.doc, doc)),
    }
  },
})

export const create = zm({
  args: {
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
    ownerId: zx.id('users'),
    assigneeId: zx.id('users').optional(),
    dueDate: zx.date().optional(),
    estimate: z.number().optional(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('tasks', {
      ...args,
      status: args.status ?? 'todo',
      priority: args.priority ?? null,
      estimate: args.estimate != null
        ? { hours: Math.floor(args.estimate / 60), minutes: args.estimate % 60 }
        : undefined,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('tasks'),
})

export const update = zm({
  args: {
    id: zx.id('tasks'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
    assigneeId: zx.id('users').optional(),
    dueDate: zx.date().optional(),
    estimate: z.number().optional(),
  },
  handler: async (ctx, { id, estimate, ...fields }) => {
    await ctx.db.patch(id, {
      ...fields,
      ...(estimate != null
        ? { estimate: { hours: Math.floor(estimate / 60), minutes: estimate % 60 } }
        : {}),
    })
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
