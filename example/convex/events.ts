import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './setup'
import { Events } from './schema'

export const get = zq({
  args: { eventId: zx.id('events') },
  returns: Events.schema.doc.nullable(),
  handler: async (ctx: any, { eventId }: any) => {
    return ctx.db.get(eventId)
  },
})

export const listUpcoming = zq({
  args: {},
  returns: Events.schema.docArray,
  handler: async (ctx: any) => {
    return ctx.db.query('events').collect()
  },
})

export const create = zm({
  args: {
    title: z.string(),
    startDate: zx.date(),
    endDate: zx.date().optional(),
    organizerId: zx.id('users'),
  },
  handler: async (ctx: any, args: any) => {
    return ctx.db.insert('events', args)
  },
})
