import { z } from 'zod'
import { attachMeta } from '../../../../src/meta'

const phoneVariant = z.object({ type: z.literal('phone'), duration: z.number() })
const inPersonVariant = z.object({ type: z.literal('in-person'), roomId: z.string() })

const insertSchema = z.discriminatedUnion('type', [phoneVariant, inPersonVariant])

const docSchema = z.union([
  phoneVariant.extend({ _id: z.string(), _creationTime: z.number() }),
  inPersonVariant.extend({ _id: z.string(), _creationTime: z.number() })
])

const EventModel = {
  name: 'events',
  schema: {
    doc: docSchema,
    insert: insertSchema,
    update: z.union([
      z.object({
        _id: z.string(),
        type: z.literal('phone').optional(),
        duration: z.number().optional()
      }),
      z.object({
        _id: z.string(),
        type: z.literal('in-person').optional(),
        roomId: z.string().optional()
      })
    ]),
    docArray: z.array(docSchema),
    paginatedDoc: z.object({
      page: z.array(docSchema),
      isDone: z.boolean(),
      continueCursor: z.string().nullable().optional()
    })
  }
}

attachMeta(EventModel, {
  type: 'model',
  tableName: 'events',
  schemas: EventModel.schema
})

export { EventModel }
