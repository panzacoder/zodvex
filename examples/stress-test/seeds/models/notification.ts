import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

const EmailNotification = z.object({
  kind: z.literal('email'),
  recipientId: zx.id('notifications'),
  subject: z.string(),
  body: z.string(),
  sentAt: zx.date(),
  createdAt: zx.date(),
})

const PushNotification = z.object({
  kind: z.literal('push'),
  recipientId: zx.id('notifications'),
  title: z.string(),
  badge: z.number().optional(),
  sentAt: zx.date(),
  createdAt: zx.date(),
})

const InAppNotification = z.object({
  kind: z.literal('in_app'),
  recipientId: zx.id('notifications'),
  message: z.string(),
  linkTo: z.string().optional(),
  read: z.boolean(),
  createdAt: zx.date(),
})

export const notificationSchema = z.discriminatedUnion('kind', [
  EmailNotification,
  PushNotification,
  InAppNotification,
])

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const NotificationModel = defineZodModel('notifications', notificationSchema, opts)
  .index('by_recipient', ['recipientId'])
  .index('by_kind', ['kind'])
  .index('by_created', ['createdAt'])
