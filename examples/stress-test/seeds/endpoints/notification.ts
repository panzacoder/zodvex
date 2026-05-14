import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { NotificationModel } from '../models/notification'

const byIdArgs = { id: zx.id('notifications') }

export const getNotification = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(NotificationModel).nullable(),
})

export const listNotifications = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('notifications').collect(),
  returns: zx.docArray(NotificationModel),
})

export const createNotification = zm({
  args: {
    kind: z.literal('in_app'),
    recipientId: zx.id('notifications'),
    message: z.string(),
    read: z.boolean(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert('notifications', { ...args, createdAt: new Date() }),
  returns: zx.id('notifications'),
})

export const updateNotification = zm({
  args: { id: zx.id('notifications'), message: z.string() },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteNotification = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
