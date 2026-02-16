import { z } from 'zod'
import { zx } from 'zodvex/core'
import { defineZodSchema, zodTable } from 'zodvex/server'
import { stateCode } from './stateCode'

export const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
  state: stateCode(),
})

export const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users'),
})

export default defineZodSchema({
  users: Users,
  events: Events,
})
