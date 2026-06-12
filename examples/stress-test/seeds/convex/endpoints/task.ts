import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { taskFields, TaskDoc } from '../models/task'

const byIdArgs = { id: v.id('tasks') }

export const getTask = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('tasks'), _creationTime: v.number(), ...taskFields })),
})

export const listTasks = query({
  args: {},
  handler: async (ctx) => ctx.db.query('tasks').collect(),
  returns: v.array(v.object({ _id: v.id('tasks'), _creationTime: v.number(), ...taskFields })),
})

export const createTask = mutation({
  args: { title: taskFields.title, priority: taskFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('tasks', { ...args, done: false, createdAt: Date.now() }),
  returns: v.id('tasks'),
})

export const updateTask = mutation({
  args: { id: v.id('tasks'), title: taskFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteTask = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
