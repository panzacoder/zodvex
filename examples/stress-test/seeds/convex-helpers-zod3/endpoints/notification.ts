import { z } from 'zod/v3'
import { zid } from 'convex-helpers/server/zod3'
import { zQuery, zMutation } from '../functions'
import { notificationSchema } from '../models/notification'

const byIdArgs = { id: zid('notifications') }

export const getNotification = zQuery({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: notificationSchema.nullable(),
})

export const listNotifications = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('notifications').collect(),
  returns: z.array(notificationSchema),
})

export const createNotification = zMutation({
  args: {
    kind: z.literal('in_app'),
    recipientId: zid('notifications'),
    message: z.string(),
    read: z.boolean(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert('notifications', { ...args, createdAt: Date.now() }),
  returns: zid('notifications'),
})

export const updateNotification = zMutation({
  args: { id: zid('notifications'), message: z.string() },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteNotification = zMutation({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
