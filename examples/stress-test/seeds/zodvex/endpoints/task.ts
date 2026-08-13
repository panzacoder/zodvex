import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { TaskModel, taskFields } from '../models/task'

const byIdArgs = { id: zx.id('tasks') }

export const getTask = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(TaskModel).nullable(),
})

export const listTasks = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('tasks').collect(),
  returns: zx.docArray(TaskModel),
})

export const createTask = zm({
  args: { title: taskFields.title, priority: taskFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('tasks', { ...args, done: false, createdAt: new Date() }),
  returns: zx.id('tasks'),
})

export const updateTask = zm({
  args: { id: zx.id('tasks'), title: taskFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteTask = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
