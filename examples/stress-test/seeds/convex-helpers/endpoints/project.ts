import { z } from 'zod'
import { zid } from 'convex-helpers/server/zod4'
import { zQuery, zMutation } from '../functions'
import { projectFields } from '../models/project'

const byIdArgs = { id: zid('projects') }
const projectDoc = z.object({ _id: zid('projects'), _creationTime: z.number(), ...projectFields })

export const getProject = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: projectDoc.nullable(),
})

export const listProjects = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('projects').collect(),
  returns: z.array(projectDoc),
})

export const createProject = zMutation({
  args: { name: projectFields.name, ownerId: projectFields.ownerId },
  handler: async (ctx, args) =>
    ctx.db.insert('projects', { ...args, active: true, createdAt: Date.now() }),
  returns: zid('projects'),
})

export const updateProject = zMutation({
  args: { id: zid('projects'), name: projectFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteProject = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
