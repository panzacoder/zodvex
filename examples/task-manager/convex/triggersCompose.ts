import { Triggers } from 'convex-helpers/server/triggers'
import { z } from 'zod'
import { zx } from 'zodvex'
import { initZodvex } from 'zodvex/server'
import type { DataModel } from './_generated/dataModel'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'
import schema from './schema'

/**
 * convex-helpers triggers composed UNDER the zodvex codec layer (zodvex#92).
 *
 * Stack: codec (zodvex) → triggers (convex-helpers) → real db.
 *
 * The trigger layer sees wire-format writes — zodvex encodes zx.date() to a
 * number before the write reaches the trigger writer — which is exactly the
 * native db shape convex-helpers triggers are written against. Trigger
 * functions receive raw Convex ctx + innerDb; their own writes bypass the
 * codec layer, so they use native wire values.
 */
const triggers = new Triggers<DataModel>()

triggers.register('tasks', async (ctx, change) => {
  const doc = change.newDoc ?? change.oldDoc

  // Record what the trigger observed — wireDueDate pins encode ordering.
  await ctx.innerDb.insert('triggerLog', {
    taskId: change.id,
    operation: change.operation,
    wireDueDate: typeof doc.dueDate === 'number' ? doc.dueDate : null,
    wireDueDateType: typeof doc.dueDate,
    createdAt: Date.now(),
  })

  // Aggregate-style count per owner (the hotpot table-trigger use case).
  const delta = change.operation === 'insert' ? 1 : change.operation === 'delete' ? -1 : 0
  if (delta === 0) return
  const existing = await ctx.innerDb
    .query('taskCounts')
    .withIndex('by_owner', (q) => q.eq('ownerId', doc.ownerId))
    .unique()
  if (existing) {
    await ctx.innerDb.patch('taskCounts', existing._id, { count: existing.count + delta })
  } else {
    await ctx.innerDb.insert('taskCounts', {
      ownerId: doc.ownerId,
      count: delta,
      createdAt: Date.now(),
    })
  }
})

// Composed builders: zodvex codec on top, triggers underneath.
const { zm: triggerMutation, zq: triggerQuery } = initZodvex(
  schema,
  { query, mutation, action, internalQuery, internalMutation, internalAction },
  {
    underlyingDb: { mutation: (ctx) => triggers.wrapDB(ctx).db },
  }
)

export const createTask = triggerMutation({
  args: {
    title: z.string(),
    ownerId: zx.id('users'),
    dueDate: zx.date().optional(),
  },
  returns: zx.id('tasks'),
  handler: async (ctx, { title, ownerId, dueDate }) => {
    // dueDate arrives decoded (Date); the codec db encodes it to a number
    // before the trigger layer observes the insert.
    return await ctx.db.insert('tasks', {
      title,
      status: 'todo',
      priority: null,
      ownerId,
      dueDate,
      createdAt: new Date(),
    })
  },
})

export const rescheduleTask = triggerMutation({
  args: { taskId: zx.id('tasks'), dueDate: zx.date() },
  returns: z.null(),
  handler: async (ctx, { taskId, dueDate }) => {
    await ctx.db.patch(taskId, { dueDate })
    return null
  },
})

export const removeTask = triggerMutation({
  args: { taskId: zx.id('tasks') },
  returns: z.null(),
  handler: async (ctx, { taskId }) => {
    await ctx.db.delete(taskId)
    return null
  },
})

export const getOwnerCount = triggerQuery({
  args: { ownerId: zx.id('users') },
  returns: z.number(),
  handler: async (ctx, { ownerId }) => {
    const row = await ctx.db
      .query('taskCounts')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .unique()
    return row?.count ?? 0
  },
})
