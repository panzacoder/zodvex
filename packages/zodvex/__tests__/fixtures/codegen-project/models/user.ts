import { z } from 'zod'
import { attachMeta } from '../../../../src/meta'

const userDocSchema = z.object({ _id: z.string(), name: z.string(), email: z.string() })

const UserModel = {
  name: 'users',
  schema: {
    doc: userDocSchema,
    insert: z.object({ name: z.string(), email: z.string() }),
    update: z.object({ name: z.string().optional(), email: z.string().optional() }),
    docArray: z.array(userDocSchema),
    paginatedDoc: z.object({
      page: z.array(userDocSchema),
      isDone: z.boolean(),
      continueCursor: z.string().nullable().optional()
    })
  }
}

attachMeta(UserModel, {
  type: 'model',
  tableName: 'users',
  schemas: UserModel.schema
})

export { UserModel }
