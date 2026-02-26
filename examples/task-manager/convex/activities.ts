import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { ActivityModel } from './models/activity'

export const get = zq({
  args: { id: zx.id('activities') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: ActivityModel.schema.doc.nullable(),
})

export const listByActor = zq({
  args: { actorId: zx.id('users') },
  handler: async (ctx, { actorId }) => {
    return await ctx.db
      .query('activities')
      .withIndex('by_actor', (q) => q.eq('actorId', actorId))
      .collect()
  },
  returns: ActivityModel.schema.docArray,
})

/**
 * Uses .partial() on the doc schema — exercises nested codec resolution.
 * The payload field becomes z.union([...]).optional(), and zodToSource must
 * walk into union variants to find the zDuration and tagged() codecs.
 */
export const update = zm({
  args: (ActivityModel.schema.doc as z.ZodObject<any>).partial().extend({
    _id: zx.id('activities'),
  }),
  handler: async (ctx, { _id, ...fields }) => {
    await ctx.db.patch(_id, fields)
  },
})
