import { z } from 'zod'
import { attachMeta } from '../../../src/meta'
import { UserModel } from './models/user'

const get = { _isRegistered: true }
attachMeta(get, {
  type: 'function',
  zodArgs: z.object({ id: z.string() }),
  zodReturns: z.object({ name: z.string() })
})

const list = { _isRegistered: true }
attachMeta(list, {
  type: 'function',
  zodArgs: z.object({}),
  zodReturns: z.array(z.object({ name: z.string() }))
})

// A plain export without metadata (should be skipped)
const helper = () => {
  /* no-op — tests that exports without metadata are skipped */
}

const update = { _isRegistered: true }
attachMeta(update, {
  type: 'function',
  zodArgs: (UserModel.schema.doc as z.ZodObject<any>).partial().extend({ _id: z.string() }),
  zodReturns: undefined
})

export { get, list, helper, update }
