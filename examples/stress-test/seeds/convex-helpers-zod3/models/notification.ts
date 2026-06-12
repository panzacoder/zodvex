import { z } from 'zod/v3'
import { defineTable } from 'convex/server'
import { zid, zodToConvex } from 'convex-helpers/server/zod3'

const EmailNotification = z.object({
  kind: z.literal('email'),
  recipientId: zid('notifications'),
  subject: z.string(),
  body: z.string(),
  sentAt: z.number(),
  createdAt: z.number(),
})

const PushNotification = z.object({
  kind: z.literal('push'),
  recipientId: zid('notifications'),
  title: z.string(),
  badge: z.number().optional(),
  sentAt: z.number(),
  createdAt: z.number(),
})

const InAppNotification = z.object({
  kind: z.literal('in_app'),
  recipientId: zid('notifications'),
  message: z.string(),
  linkTo: z.string().optional(),
  read: z.boolean(),
  createdAt: z.number(),
})

export const notificationSchema = z.discriminatedUnion('kind', [
  EmailNotification,
  PushNotification,
  InAppNotification,
])

export const NotificationTable = defineTable(zodToConvex(notificationSchema))
  .index('by_recipient', ['recipientId'])
  .index('by_kind', ['kind'])
  .index('by_created', ['createdAt'])
