import { z } from 'zod'
import { zid } from 'convex-helpers/server/zod4'
import { zQuery, zMutation } from '../functions'
import { activityFields } from '../models/activity'

const byIdArgs = { id: zid('activities') }
const activityDoc = z.object({ _id: zid('activities'), _creationTime: z.number(), ...activityFields })

export const getActivity = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: activityDoc.nullable(),
})

export const listActivities = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('activities').collect(),
  returns: z.array(activityDoc),
})

export const createActivity = zMutation({
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
  returns: zid('activities'),
})

export const updateActivity = zMutation({
  args: { id: zid('activities'), title: activityFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteActivity = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
