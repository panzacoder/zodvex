import { v } from 'convex/values'
import { query, mutation } from '../functions'
import { NotificationDoc } from '../models/notification'

const byIdArgs = { id: v.id('notifications') }

export const getNotification = query({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: v.union(v.null(), v.object({ _id: v.id('notifications'), _creationTime: v.number() })),
})

export const listNotifications = query({
  args: {},
  handler: async (ctx) => ctx.db.query('notifications').collect(),
  returns: v.array(v.object({ _id: v.id('notifications'), _creationTime: v.number() })),
})

export const createNotification = mutation({
  args: {
    kind: v.literal('in_app'),
    recipientId: v.id('notifications'),
    message: v.string(),
    read: v.boolean(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert('notifications', { ...args, createdAt: Date.now() }),
  returns: v.id('notifications'),
})

export const updateNotification = mutation({
  args: { id: v.id('notifications'), message: v.string() },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteNotification = mutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
