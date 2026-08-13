import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { ActivityModel, activityFields } from '../models/activity'

const byIdArgs = { id: zx.id('activities') }

export const getActivity = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(ActivityModel).nullable(),
})

export const listActivities = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('activities').collect(),
  returns: zx.docArray(ActivityModel),
})

export const createActivity = zm({
  args: { title: activityFields.title, ownerId: activityFields.ownerId, priority: activityFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('activities', { ...args, status: 'draft', tags: [], labels: [], metadata: { source: 'test', version: 1, features: [] }, isPublic: false, score: null, retryCount: 0, createdAt: new Date() }),
  returns: zx.id('activities'),
})

export const updateActivity = zm({
  args: { id: zx.id('activities'), title: activityFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteActivity = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
