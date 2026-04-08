import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex'

export const EventModel = defineZodModel('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  location: z.string().optional(),
})
