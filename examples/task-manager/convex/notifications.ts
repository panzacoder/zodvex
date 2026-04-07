import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm, zim } from './functions'
import { NotificationModel } from './models/notification'

export const get = zq({
  args: { id: zx.id('notifications') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: z.nullable(NotificationModel.schema.doc),
})

export const listByRecipient = zq({
  args: { recipientId: zx.id('users') },
  handler: async (ctx, { recipientId }) => {
    return await ctx.db
      .query('notifications')
      .withIndex('by_recipient', (q) => q.eq('recipientId', recipientId))
      .collect()
  },
  returns: z.array(NotificationModel.schema.doc),
})

export const listByKind = zq({
  args: { kind: z.enum(['email', 'push', 'in_app']) },
  handler: async (ctx, { kind }) => {
    return await ctx.db
      .query('notifications')
      .withIndex('by_kind', (q) => q.eq('kind', kind))
      .collect()
  },
  returns: z.array(NotificationModel.schema.doc),
})

export const listByRecipientAndKind = zq({
  args: {
    recipientId: zx.id('users'),
    kind: z.enum(['email', 'push', 'in_app']),
  },
  handler: async (ctx, { recipientId, kind }) => {
    return await ctx.db
      .query('notifications')
      .withIndex('by_recipient_and_kind', (q) =>
        q.eq('recipientId', recipientId).eq('kind', kind)
      )
      .collect()
  },
  returns: z.array(NotificationModel.schema.doc),
})

export const listByCreated = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('notifications')
      .withIndex('by_created', (q) => q.gte('createdAt', after))
      .collect()
  },
  returns: z.array(NotificationModel.schema.doc),
})

export const createEmail = zm({
  args: {
    recipientId: zx.id('users'),
    subject: z.string(),
    body: z.string(),
  },
  handler: async (ctx, { recipientId, subject, body }) => {
    const now = new Date()
    return await ctx.db.insert('notifications', {
      kind: 'email',
      recipientId,
      subject,
      body,
      sentAt: now,
      createdAt: now,
    })
  },
  returns: zx.id('notifications'),
})

export const createPush = zm({
  args: {
    recipientId: zx.id('users'),
    title: z.string(),
    badge: z.number().optional(),
  },
  handler: async (ctx, { recipientId, title, badge }) => {
    const now = new Date()
    return await ctx.db.insert('notifications', {
      kind: 'push',
      recipientId,
      title,
      badge,
      sentAt: now,
      createdAt: now,
    })
  },
  returns: zx.id('notifications'),
})

export const createInApp = zm({
  args: {
    recipientId: zx.id('users'),
    message: z.string(),
    linkTo: z.string().optional(),
  },
  handler: async (ctx, { recipientId, message, linkTo }) => {
    return await ctx.db.insert('notifications', {
      kind: 'in_app',
      recipientId,
      message,
      linkTo,
      read: false,
      createdAt: new Date(),
    })
  },
  returns: zx.id('notifications'),
})

// Internal mutation for cron job - cleans up old read in-app notifications
export const cleanupOld = zim({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const oldNotifications = await ctx.db
      .query('notifications')
      .withIndex('by_created', (q) => q.lt('createdAt', thirtyDaysAgo))
      .collect()

    let deleted = 0
    for (const notification of oldNotifications) {
      // oldNotifications is typed as unknown[] from the union table query.
      // Cast to access discriminated fields.
      const n = notification as { kind: string; read?: boolean; _id: any }
      if (n.kind === 'in_app' && n.read) {
        await ctx.db.delete(n._id)
        deleted++
      }
    }
    return deleted
  },
  returns: z.number(),
})
