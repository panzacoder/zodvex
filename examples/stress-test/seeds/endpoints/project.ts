import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { ProjectModel, projectFields } from '../models/project'

const byIdArgs = { id: zx.id('projects') }

export const getProject = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(ProjectModel).nullable(),
})

export const listProjects = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('projects').collect(),
  returns: zx.docArray(ProjectModel),
})

export const createProject = zm({
  args: { name: projectFields.name, ownerId: projectFields.ownerId },
  handler: async (ctx, args) =>
    ctx.db.insert('projects', { ...args, active: true, createdAt: new Date() }),
  returns: zx.id('projects'),
})

export const updateProject = zm({
  args: { id: zx.id('projects'), name: projectFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteProject = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
