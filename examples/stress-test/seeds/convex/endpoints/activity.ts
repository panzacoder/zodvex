import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { activityFields } from '../models/activity'

const byIdArgs = { id: v.id('activities') }

export const getActivity = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('activities'), _creationTime: v.number(), ...activityFields })),
})

export const listActivities = query({
  args: {},
  handler: async (ctx) => ctx.db.query('activities').collect(),
  returns: v.array(v.object({ _id: v.id('activities'), _creationTime: v.number(), ...activityFields })),
})

export const createActivity = mutation({
  args: { title: activityFields.title, ownerId: activityFields.ownerId, priority: activityFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('activities', {
      ...args,
      status: 'draft',
      contact: { kind: 'email', email: '', verified: false },
      tags: [],
      labels: [],
      metadata: { source: 'test', version: 1, features: [] },
      isPublic: false,
      score: null,
      retryCount: 0,
      createdAt: Date.now(),
    }),
  returns: v.id('activities'),
})

export const updateActivity = mutation({
  args: { id: v.id('activities'), title: activityFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteActivity = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
