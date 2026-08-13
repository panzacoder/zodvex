import { defineTable } from 'convex/server'
import { v } from 'convex/values'

const addressObject = v.object({
  street: v.string(),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  country: v.optional(v.string()),
})

const contactVariantA = v.object({
  kind: v.literal('email'),
  email: v.string(),
  verified: v.boolean(),
})

const contactVariantB = v.object({
  kind: v.literal('phone'),
  phone: v.string(),
  extension: v.optional(v.string()),
})

const contactVariantC = v.object({
  kind: v.literal('address'),
  address: addressObject,
  isPrimary: v.boolean(),
})

export const activityFields = {
  title: v.string(),
  description: v.optional(v.string()),
  status: v.union(
    v.literal('draft'),
    v.literal('review'),
    v.literal('active'),
    v.literal('suspended'),
    v.literal('archived')
  ),
  priority: v.number(),
  ownerId: v.id('activities'),
  assigneeId: v.optional(v.id('activities')),
  contact: v.union(contactVariantA, contactVariantB, contactVariantC),
  tags: v.array(v.string()),
  labels: v.array(v.object({ name: v.string(), color: v.string() })),
  metadata: v.object({
    source: v.string(),
    version: v.number(),
    features: v.array(v.string()),
  }),
  isPublic: v.boolean(),
  score: v.union(v.number(), v.null()),
  rating: v.optional(v.number()),
  retryCount: v.number(),
  lastActivityAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
}

export const ActivityDoc = v.object(activityFields)

export const ActivityTable = defineTable(activityFields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
  .index('by_priority', ['priority'])
