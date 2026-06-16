import { z } from 'zod/v3'
import { zid } from 'convex-helpers/server/zod3'
import { zQuery, zMutation } from '../functions'
import { taskFields } from '../models/task'

const byIdArgs = { id: zid('tasks') }
const taskDoc = z.object({ _id: zid('tasks'), _creationTime: z.number(), ...taskFields })

export const getTask = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: taskDoc.nullable(),
})

export const listTasks = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('tasks').collect(),
  returns: z.array(taskDoc),
})

export const createTask = zMutation({
  args: { title: taskFields.title, priority: taskFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('tasks', { ...args, done: false, createdAt: Date.now() }),
  returns: zid('tasks'),
})

export const updateTask = zMutation({
  args: { id: zid('tasks'), title: taskFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteTask = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
