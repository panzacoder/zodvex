import { z } from 'zod'
import { attachMeta } from '../../../../src/meta'

const UserModel = {
  name: 'users',
  schema: {
    doc: z.object({ _id: z.string(), name: z.string(), email: z.string() }),
    insert: z.object({ name: z.string(), email: z.string() }),
    update: z.object({ name: z.string().optional(), email: z.string().optional() }),
    docArray: z.array(z.object({ _id: z.string(), name: z.string(), email: z.string() }))
  }
}

attachMeta(UserModel, {
  type: 'model',
  tableName: 'users',
  schemas: UserModel.schema
})

export { UserModel }
