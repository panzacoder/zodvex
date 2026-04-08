import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from './functions'
import { EventModel } from './models'

export const list = zq({
  args: {},
  returns: EventModel.schema.docArray,
  handler: async (ctx) => {
    // Dates come back as Date objects, not numbers
    return await ctx.db.query('events').collect()
  },
})

export const create = zm({
  args: {
    title: z.string(),
    startDate: zx.date(),
    endDate: zx.date().optional(),
    location: z.string().optional(),
  },
  returns: zx.id('events'),
  handler: async (ctx, args) => {
    // Dates are automatically encoded to timestamps on write
    return await ctx.db.insert('events', args)
  },
})
