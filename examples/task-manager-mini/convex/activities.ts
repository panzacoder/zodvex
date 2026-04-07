import { z } from 'zod/mini'
import { zx } from 'zodvex/mini'
import { zq, zm } from './functions'
import { ActivityModel } from './models/activity'

export const get = zq({
  args: { id: zx.id('activities') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: z.nullable(ActivityModel.schema.doc),
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

export const update = zm({
  args: ActivityModel.schema.update,
  handler: async (ctx, { _id, ...fields }) => {
    await ctx.db.patch(_id, fields)
  },
})
