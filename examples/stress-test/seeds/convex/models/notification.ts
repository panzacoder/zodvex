import { defineTable } from 'convex/server'
import { v } from 'convex/values'

const EmailNotification = v.object({
  kind: v.literal('email'),
  recipientId: v.id('notifications'),
  subject: v.string(),
  body: v.string(),
  sentAt: v.number(),
  createdAt: v.number(),
})

const PushNotification = v.object({
  kind: v.literal('push'),
  recipientId: v.id('notifications'),
  title: v.string(),
  badge: v.optional(v.number()),
  sentAt: v.number(),
  createdAt: v.number(),
})

const InAppNotification = v.object({
  kind: v.literal('in_app'),
  recipientId: v.id('notifications'),
  message: v.string(),
  linkTo: v.optional(v.string()),
  read: v.boolean(),
  createdAt: v.number(),
})

export const NotificationDoc = v.union(
  EmailNotification,
  PushNotification,
  InAppNotification
)

export const NotificationTable = defineTable(NotificationDoc)
  .index('by_recipient', ['recipientId'])
  .index('by_kind', ['kind'])
  .index('by_created', ['createdAt'])
