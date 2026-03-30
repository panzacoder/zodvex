import { defineZodSchema } from 'zodvex/server'
import { EventModel } from './models'

export default defineZodSchema({
  events: EventModel,
})
