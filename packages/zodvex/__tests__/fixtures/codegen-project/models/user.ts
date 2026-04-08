import { z } from 'zod'
import { attachMeta } from '../../../../src/internal/meta'
import { tagged } from '../tagged'

const taggedEmail = tagged(z.string())
const userDocSchema = z.object({ _id: z.string(), name: z.string(), email: taggedEmail.optional() })

const UserModel = {
  name: 'users',
  schema: {
    doc: userDocSchema,
    insert: z.object({ name: z.string(), email: taggedEmail.optional() }),
    update: z.object({ name: z.string().optional(), email: taggedEmail.optional() }),
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
