import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string().optional(),
})

const contactVariantA = z.object({
  kind: z.literal('email'),
  email: z.string(),
  verified: z.boolean(),
})

const contactVariantB = z.object({
  kind: z.literal('phone'),
  phone: z.string(),
  extension: z.string().optional(),
})

const contactVariantC = z.object({
  kind: z.literal('address'),
  address: addressSchema,
  isPrimary: z.boolean(),
})

export const activityFields = {
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['draft', 'review', 'active', 'suspended', 'archived']),
  priority: z.number(),
  ownerId: zx.id('activities'),
  assigneeId: zx.id('activities').optional(),
  contact: z.discriminatedUnion('kind', [contactVariantA, contactVariantB, contactVariantC]),
  tags: z.array(z.string()),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
  metadata: z.object({
    source: z.string(),
    version: z.number(),
    features: z.array(z.string()),
  }),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  rating: z.number().optional(),
  retryCount: z.number(),
  lastActivityAt: zx.date().optional(),
  createdAt: zx.date(),
  updatedAt: zx.date().optional(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const ActivityModel = defineZodModel('activities', activityFields, opts)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
  .index('by_priority', ['priority'])
