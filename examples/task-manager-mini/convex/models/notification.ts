import { z } from 'zod/mini'
import { zx, defineZodModel } from 'zodvex/mini'

/**
 * Top-level discriminated union table — the document itself varies by kind.
 *
 * This is the pattern from Discord thread #1313408550407634964 (Bazza's report):
 * a table where the entire row shape is a discriminated union, not a field within
 * an object. Indexes are defined on shared fields across all variants.
 */

const EmailNotification = z.object({
  kind: z.literal('email'),
  recipientId: zx.id('users'),
  subject: z.string(),
  body: z.string(),
  sentAt: zx.date(),
  createdAt: zx.date(),
})

const PushNotification = z.object({
  kind: z.literal('push'),
  recipientId: zx.id('users'),
  title: z.string(),
  badge: z.optional(z.number()),
  sentAt: zx.date(),
  createdAt: zx.date(),
})

const InAppNotification = z.object({
  kind: z.literal('in_app'),
  recipientId: zx.id('users'),
  message: z.string(),
  linkTo: z.optional(z.string()),
  read: z.boolean(),
  createdAt: zx.date(),
})

export const notificationSchema = z.discriminatedUnion('kind', [
  EmailNotification,
  PushNotification,
  InAppNotification,
])

// Top-level union model with indexes on shared fields
export const NotificationModel = defineZodModel('notifications', notificationSchema)
  .index('by_recipient', ['recipientId'])
  .index('by_kind', ['kind'])
  .index('by_created', ['createdAt'])
  .index('by_recipient_and_kind', ['recipientId', 'kind'])
