import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { projectFields } from '../models/project'

const byIdArgs = { id: v.id('projects') }

export const getProject = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('projects'), _creationTime: v.number(), ...projectFields })),
})

export const listProjects = query({
  args: {},
  handler: async (ctx) => ctx.db.query('projects').collect(),
  returns: v.array(v.object({ _id: v.id('projects'), _creationTime: v.number(), ...projectFields })),
})

export const createProject = mutation({
  args: { name: projectFields.name, ownerId: projectFields.ownerId },
  handler: async (ctx, args) =>
    ctx.db.insert('projects', { ...args, active: true, createdAt: Date.now() }),
  returns: v.id('projects'),
})

export const updateProject = mutation({
  args: { id: v.id('projects'), name: projectFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteProject = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
